/**
 * Source municipale : plateforme de recrutement de la Câmara Municipal de Sátão.
 *
 * La page est rendue par WireRecruit (Rails). Deux signaux sont croisés plutôt
 * que d'en croire un seul :
 *   1. l'absence de l'avis « Não existem procedimentos concursais ativos » ;
 *   2. la présence de liens de procédure portant `recruitment_process_id`.
 *
 * Aucune dépendance externe : la page est parsée au regex.
 */

export const SATAO_URL = "https://recrutamento.cm-satao.pt/processos-ativos";

/** État du concours, tel que la source le présente. */
export type ContestState = "Aberto" | "Fechado";

export interface SataoProcess {
  /** `recruitment_process_id` de la source, utilisé comme clé de déduplication. */
  readonly id: string;
  readonly title: string;
  readonly url: string;
}

export interface SataoResult {
  readonly state: ContestState;
  readonly processes: readonly SataoProcess[];
  /** Vrai quand l'avis « aucun procédimento actif » est présent sur la page. */
  readonly emptyNoticeFound: boolean;
  readonly checkedAt: string;
}

/**
 * Avis d'absence de procédure. Tolérant à la casse, aux espaces multiples et à
 * un `n` non accentué : la source écrit « Não existem procedimentos concursais
 * ativos. » avec une majuscule, mais rien ne garantit qu'elle s'y tienne.
 */
const EMPTY_NOTICE = /n[ãa]o\s+existem\s+procedimentos\s+concursais\s+ativos/i;

/** Balises `<a>` transportant un identifiant de procédure. */
const PROCESS_ANCHOR = /<a\b[^>]*recruitment_process_id=\d+[^>]*>/gi;

const PROCESS_ID = /recruitment_process_id=(\d+)/i;
const HREF = /\bhref\s*=\s*"([^"]*)"/i;
const ARIA_LABEL = /\baria-label\s*=\s*"([^"]*)"/i;

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00a0",
  // La source rend l'UTF-8 en clair, mais les intitulés portugais sont pleins
  // de caractères qu'un changement de rendu encoderait en entités nommées.
  aacute: "á",
  acirc: "â",
  agrave: "à",
  atilde: "ã",
  ccedil: "ç",
  eacute: "é",
  ecirc: "ê",
  iacute: "í",
  oacute: "ó",
  ocirc: "ô",
  otilde: "õ",
  uacute: "ú",
  Aacute: "Á",
  Atilde: "Ã",
  Ccedil: "Ç",
  Eacute: "É",
  Iacute: "Í",
  Oacute: "Ó",
  Otilde: "Õ",
  Uacute: "Ú",
};

/** Décode les entités HTML courantes, sans dépendance ni DOM. */
export function decodeHtml(input: string): string {
  return input.replace(
    /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,
    (match: string, entity: string): string => {
      const lower = entity.toLowerCase();
      if (lower.startsWith("#x")) {
        const code = Number.parseInt(entity.slice(2), 16);
        return Number.isNaN(code) ? match : String.fromCodePoint(code);
      }
      if (lower.startsWith("#")) {
        const code = Number.parseInt(entity.slice(1), 10);
        return Number.isNaN(code) ? match : String.fromCodePoint(code);
      }
      return NAMED_ENTITIES[entity] ?? NAMED_ENTITIES[lower] ?? match;
    },
  );
}

function absolutize(href: string): string {
  if (href.startsWith("http://") || href.startsWith("https://")) return href;
  return new URL(href, SATAO_URL).toString();
}

/** Extrait les procédures listées, dédupliquées par `recruitment_process_id`. */
export function extractProcesses(html: string): SataoProcess[] {
  const byId = new Map<string, SataoProcess>();

  for (const [tag] of html.matchAll(PROCESS_ANCHOR)) {
    const idMatch = PROCESS_ID.exec(tag);
    const id = idMatch?.[1];
    if (id === undefined || byId.has(id)) continue;

    const href = HREF.exec(tag)?.[1];
    const label = ARIA_LABEL.exec(tag)?.[1];

    byId.set(id, {
      id,
      title: label === undefined ? "" : decodeHtml(label).trim(),
      url: href === undefined ? SATAO_URL : absolutize(decodeHtml(href)),
    });
  }

  return [...byId.values()];
}

/** Croise les deux signaux d'une page déjà récupérée. */
export function parseSatao(html: string, checkedAt: string): SataoResult {
  const emptyNoticeFound = EMPTY_NOTICE.test(html);
  const processes = extractProcesses(html);
  const state: ContestState =
    processes.length > 0 && !emptyNoticeFound ? "Aberto" : "Fechado";

  return { state, processes, emptyNoticeFound, checkedAt };
}

/** Récupère puis parse la page municipale. */
export async function fetchSatao(): Promise<SataoResult> {
  const response = await fetch(SATAO_URL, {
    cache: "no-store",
    headers: {
      "User-Agent": "satao-watch (surveillance de procédures concursais)",
      Accept: "text/html",
    },
  });

  if (!response.ok) {
    throw new Error(
      `La source municipale a répondu ${response.status} ${response.statusText}.`,
    );
  }

  return parseSatao(await response.text(), new Date().toISOString());
}
