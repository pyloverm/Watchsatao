import {
  anomalySignature,
  hasFailed,
  runWatch,
  type Anomaly,
  type Opening,
  type WatchResult,
} from "@/lib/watch";
import {
  readState,
  sendEmail,
  stateStorageConfigured,
  writeState,
} from "@/lib/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const STATE_KEY = "satao-watch:state";
const ALERT_KEY = "satao-watch:alerte";

/** Comparaison à temps constant, pour ne pas fuiter le secret octet par octet. */
function secretMatches(provided: string, expected: string): boolean {
  const a = new TextEncoder().encode(provided);
  const b = new TextEncoder().encode(expected);
  let diff = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0;
}

function authorized(request: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (expected === undefined || expected.trim() === "") return false;

  const header = request.headers.get("authorization");
  const bearer =
    header?.startsWith("Bearer ") === true
      ? header.slice("Bearer ".length)
      : undefined;
  const provided = bearer ?? request.headers.get("x-cron-secret") ?? undefined;

  return provided !== undefined && secretMatches(provided, expected.trim());
}

function escape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function line(opening: Opening): string {
  const details = [
    opening.code,
    opening.entity,
    opening.deadline === undefined
      ? undefined
      : `candidatures jusqu'au ${opening.deadline}`,
    `annoncée par ${opening.sources.join(" et ")}`,
  ]
    .filter((part): part is string => part !== undefined && part !== "")
    .map(escape)
    .join(" · ");

  return `<li><a href="${escape(opening.url)}">${escape(opening.title)}</a><br><small>${details}</small></li>`;
}

function openingEmail(result: WatchResult): { subject: string; html: string } {
  return {
    subject: `Sátão : ${result.openings.length} candidature(s) ouverte(s)`,
    html: [
      "<h1>Un procédimento concursal accepte des candidatures</h1>",
      `<ul>${result.openings.map(line).join("")}</ul>`,
      '<p><a href="https://recrutamento.cm-satao.pt/processos-ativos">Plateforme municipale</a> · ',
      '<a href="https://www.bep.gov.pt/pages/oferta/Oferta_Pesquisa_basica.aspx">Bolsa de Emprego Público</a></p>',
    ].join(""),
  };
}

/**
 * Alerte technique, volontairement distincte de l'alerte de concours : elle ne
 * dit pas qu'un poste s'ouvre, elle dit que l'app a cessé de savoir le voir.
 */
function alertEmail(anomalies: readonly Anomaly[]): {
  subject: string;
  html: string;
} {
  const blind = anomalies.some((anomaly) => anomaly.kind === "unrecognized");

  return {
    subject: blind
      ? "satao-watch : parsing hors service"
      : "satao-watch : source injoignable",
    html: [
      "<h1>Alerte technique — ceci ne concerne aucun concours</h1>",
      "<p>La surveillance ne fonctionne plus comme prévu :</p>",
      `<ul>${anomalies.map((anomaly) => `<li>${escape(anomaly.message)}</li>`).join("")}</ul>`,
      blind
        ? "<p><strong>Tant que ce n'est pas corrigé, une ouverture de " +
          "candidatures peut passer inaperçue.</strong> L'état affiché ne " +
          "vaut plus rien.</p>"
        : "<p>Si la source revient d'elle-même, un message de rétablissement " +
          "suivra.</p>",
    ].join(""),
  };
}

function recoveryEmail(): { subject: string; html: string } {
  return {
    subject: "satao-watch : surveillance rétablie",
    html:
      "<h1>Surveillance rétablie</h1>" +
      "<p>Les deux sources répondent de nouveau et sont comprises. " +
      "L'état affiché est de nouveau fiable.</p>",
  };
}

export async function GET(request: Request): Promise<Response> {
  if (!authorized(request)) {
    return Response.json({ error: "Non autorisé." }, { status: 401 });
  }

  const result = await runWatch();

  // Les deux sources muettes : rien à conclure, et surtout rien à mémoriser.
  if (hasFailed(result.satao) && hasFailed(result.bep)) {
    return Response.json(
      {
        error: "Les deux sources sont injoignables.",
        satao: result.satao.message,
        bep: result.bep.message,
      },
      { status: 502 },
    );
  }

  // L'alerte technique part avant toute autre considération : si l'app ne
  // sait plus lire ses sources, c'est la seule information qui compte.
  const signature = anomalySignature(result.anomalies);
  const previousSignature = (await readState(ALERT_KEY)) ?? "";
  let alerted = false;

  if (signature !== previousSignature) {
    if (signature !== "") {
      alerted = (await sendEmail(alertEmail(result.anomalies))).sent;
    } else if (previousSignature !== "") {
      alerted = (await sendEmail(recoveryEmail())).sent;
    }
    await writeState(ALERT_KEY, signature);
  }

  const previous = await readState(STATE_KEY);
  const changed = previous !== result.state;
  let notified = false;

  // On ne notifie qu'à la transition vers Aberto. Sans mémoire (Upstash
  // absent), `previous` vaut toujours `undefined` et chaque exécution
  // ouverte renotifie.
  if (result.state === "Aberto" && changed) {
    notified = (await sendEmail(openingEmail(result))).sent;
  }

  // Un état tiré d'une source illisible n'est pas mémorisé : le retenir
  // ferait passer le vrai changement pour un non-événement au retour.
  if (changed && result.reliable) {
    await writeState(STATE_KEY, result.state);
  }

  return Response.json({
    state: result.state,
    reliable: result.reliable,
    anomalies: result.anomalies,
    openings: result.openings,
    previousState: previous ?? null,
    changed,
    notified,
    alerted,
    stateStorage: stateStorageConfigured(),
    sources: {
      satao: hasFailed(result.satao)
        ? { failed: true, message: result.satao.message }
        : {
            state: result.satao.state,
            processes: result.satao.processes.length,
            emptyNoticeFound: result.satao.emptyNoticeFound,
            recognizable: result.satao.recognizable,
          },
      bep: hasFailed(result.bep)
        ? { failed: true, message: result.bep.message }
        : {
            offers: result.bep.offers.length,
            rowsSeen: result.bep.rowsSeen,
            emptyNoticeFound: result.bep.emptyNoticeFound,
            truncated: result.bep.truncated,
            recognizable: result.bep.recognizable,
          },
    },
    checkedAt: result.checkedAt,
  });
}
