import { fetchSatao, type SataoResult } from "@/lib/satao";
import {
  readState,
  sendEmail,
  stateStorageConfigured,
  writeState,
} from "@/lib/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATE_KEY = "satao-watch:state";

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
  const bearer = header?.startsWith("Bearer ") === true
    ? header.slice("Bearer ".length)
    : undefined;
  const provided = bearer ?? request.headers.get("x-cron-secret") ?? undefined;

  return provided !== undefined && secretMatches(provided, expected.trim());
}

function openingEmail(result: SataoResult): { subject: string; html: string } {
  const items = result.processes
    .map(
      (process): string =>
        `<li><a href="${process.url}">${process.title || `Procédure ${process.id}`}</a></li>`,
    )
    .join("");

  return {
    subject: "Sátão : candidatures ouvertes",
    html: [
      "<h1>Un procédimento concursal accepte des candidatures</h1>",
      "<p>La plateforme de recrutement de la Câmara Municipal de Sátão est passée à l'état <strong>Aberto</strong>.</p>",
      items === "" ? "" : `<ul>${items}</ul>`,
      `<p><a href="https://recrutamento.cm-satao.pt/processos-ativos">Voir les processus actifs</a></p>`,
    ].join(""),
  };
}

export async function GET(request: Request): Promise<Response> {
  if (!authorized(request)) {
    return Response.json({ error: "Non autorisé." }, { status: 401 });
  }

  let result: SataoResult;
  try {
    result = await fetchSatao();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 502 });
  }

  const previous = await readState(STATE_KEY);
  const changed = previous !== result.state;
  let notified = false;

  // On ne notifie qu'à la transition vers Aberto. Sans mémoire (Upstash absent),
  // `previous` vaut toujours `undefined` et chaque exécution ouverte renotifie.
  if (result.state === "Aberto" && changed) {
    const outcome = await sendEmail(openingEmail(result));
    notified = outcome.sent;
  }

  if (changed) {
    await writeState(STATE_KEY, result.state);
  }

  return Response.json({
    state: result.state,
    processes: result.processes,
    previousState: previous ?? null,
    changed,
    notified,
    stateStorage: stateStorageConfigured(),
    checkedAt: result.checkedAt,
  });
}
