/**
 * Seconde source : la Bolsa de Emprego Público (bep.gov.pt), qui publie
 * parfois les avis avant la plateforme municipale.
 *
 * Le moteur est un WebForms ASP.NET : rien ne s'obtient en GET. La séquence
 * observée sur le site réel est en trois temps :
 *   1. GET de l'accueil, pour obtenir le cookie de session — sans lui, toute
 *      page de recherche redirige vers ErroSessaoExpirada.aspx ;
 *   2. GET du formulaire, pour lire le `__VIEWSTATE` du moment ;
 *   3. POST du formulaire avec ce ViewState, le terme recherché et le nom du
 *      bouton, qui renvoie la grille de résultats dans la même page.
 *
 * `fetch` ne gère pas les cookies : la session est portée à la main.
 */

import { decodeHtml } from "./satao.ts";

const BEP_ORIGIN = "https://www.bep.gov.pt";
const BEP_HOME = `${BEP_ORIGIN}/`;
export const BEP_SEARCH_URL = `${BEP_ORIGIN}/pages/oferta/Oferta_Pesquisa_basica.aspx`;

/**
 * Terme envoyé au moteur. La recherche libre couvre l'organisme ; le filtrage
 * fin sur l'entité se fait ensuite côté client, le moteur étant trop large.
 */
export const BEP_QUERY = "Sátão";

/**
 * La BEP nomme les mairies « Câmara Municipal de X », jamais « Município de
 * X ». On retient donc toute entité dont le nom mentionne Sátão, ce qui
 * couvre les deux formes.
 */
export const ENTITY_PATTERN = /satao/;

export interface BepOffer {
  /** Code d'offre, ex. `OE202609/0087`. Clé de déduplication inter-sources. */
  readonly code: string;
  readonly entity: string;
  readonly type: string;
  readonly career: string;
  readonly district: string;
  readonly deadline: string;
}

export interface BepResult {
  readonly offers: readonly BepOffer[];
  /** Vrai si la BEP annonce explicitement l'absence d'offre. */
  readonly emptyNoticeFound: boolean;
  /**
   * Vrai si la grille est paginée : les résultats au-delà de la première page
   * ne sont pas lus. Remonté plutôt que tu, pour ne pas tronquer en silence.
   */
  readonly truncated: boolean;
}

const EMPTY_NOTICE = /n[ãa]o\s+existem\s+ofertas/i;
const PAGER = /Page\$\d+/;

const TABLE = /<table\b[^>]*>([\s\S]*?)<\/table>/gi;
const ROW = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
const CELL = /<td\b[^>]*>([\s\S]*?)<\/td>/gi;

/** Code d'offre de la BEP, ex. `OE202609/0087`. */
export const OFFER_CODE = /\b(OE\d{6}\/\d{4})\b/;

/** Replie les accents, pour comparer « Sátão », « Satao » et « SÁTÃO ». */
export function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function text(html: string): string {
  return decodeHtml(html.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function cells(row: string): string[] {
  return [...row.matchAll(CELL)].map(([, cell]) => text(cell ?? ""));
}

/**
 * Lit la grille `GvOfertaGestao` d'une réponse de recherche et ne retient que
 * les offres de l'entité visée.
 */
export function parseBep(
  html: string,
  entityPattern: RegExp = ENTITY_PATTERN,
): BepResult {
  const offers = new Map<string, BepOffer>();

  for (const [, body] of html.matchAll(TABLE)) {
    for (const [, row] of (body ?? "").matchAll(ROW)) {
      const columns = cells(row ?? "");
      // Código, Tipo, Vínculo, Carreira, Categoria, Distrito, Organismo,
      // Habilitação, Data : neuf colonnes, l'en-tête n'en ayant aucune en <td>.
      if (columns.length < 9) continue;

      const code = OFFER_CODE.exec(columns[0] ?? "")?.[1];
      if (code === undefined || offers.has(code)) continue;

      const entity = columns[6] ?? "";
      if (!entityPattern.test(fold(entity))) continue;

      offers.set(code, {
        code,
        entity,
        type: columns[1] ?? "",
        career: columns[3] ?? "",
        district: columns[5] ?? "",
        deadline: columns[8] ?? "",
      });
    }
  }

  return {
    offers: [...offers.values()],
    emptyNoticeFound: EMPTY_NOTICE.test(html),
    truncated: PAGER.test(html),
  };
}

/** Concatène les cookies d'une réponse dans le pot de session. */
function collectCookies(response: Response, jar: Map<string, string>): void {
  for (const cookie of response.headers.getSetCookie()) {
    const pair = cookie.split(";", 1)[0];
    const separator = pair?.indexOf("=") ?? -1;
    if (pair === undefined || separator <= 0) continue;
    jar.set(pair.slice(0, separator), pair.slice(separator + 1));
  }
}

function cookieHeader(jar: Map<string, string>): string {
  return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
}

/** Valeur d'un champ caché du formulaire ASP.NET. */
export function hiddenField(html: string, name: string): string {
  const pattern = new RegExp(
    `<input[^>]*name="${name.replace(/\$/g, "\\$")}"[^>]*>`,
    "i",
  );
  const tag = pattern.exec(html)?.[0];
  if (tag === undefined) return "";
  return decodeHtml(/\bvalue="([^"]*)"/i.exec(tag)?.[1] ?? "");
}

/**
 * Nom complet d'un champ, relevé dans le formulaire plutôt que codé en dur :
 * le préfixe `ctl00$ctl00$…` change au moindre remaniement de la page.
 */
export function fieldName(html: string, suffix: string): string | undefined {
  const pattern = new RegExp(`name="([^"]*\\$${suffix})"`, "i");
  return pattern.exec(html)?.[1];
}

/** Construit le corps du POST de recherche à partir du formulaire reçu. */
export function buildSearchBody(
  formHtml: string,
  query: string,
): URLSearchParams | undefined {
  const valueField = fieldName(formHtml, "txtValor");
  const searchButton = fieldName(formHtml, "ucSearch");
  if (valueField === undefined || searchButton === undefined) return undefined;

  const body = new URLSearchParams();
  body.set("__EVENTTARGET", "");
  body.set("__EVENTARGUMENT", "");
  body.set("__VIEWSTATE", hiddenField(formHtml, "__VIEWSTATE"));
  body.set("__VIEWSTATEGENERATOR", hiddenField(formHtml, "__VIEWSTATEGENERATOR"));
  body.set("__VIEWSTATEENCRYPTED", "");
  body.set(valueField, query);
  body.set(searchButton, "Pesquisar");
  return body;
}

const HEADERS: Readonly<Record<string, string>> = {
  // Le moteur renvoie ErroSessaoExpirada aux clients sans user-agent usuel.
  "User-Agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36",
  "Accept-Language": "pt-PT,pt;q=0.9",
  Accept: "text/html",
};

/** Interroge la BEP et ne renvoie que les offres de l'entité visée. */
export async function fetchBep(
  query: string = BEP_QUERY,
  entityPattern: RegExp = ENTITY_PATTERN,
): Promise<BepResult> {
  const jar = new Map<string, string>();

  const home = await fetch(BEP_HOME, { cache: "no-store", headers: HEADERS });
  if (!home.ok) {
    throw new Error(`La BEP a répondu ${home.status} sur l'accueil.`);
  }
  collectCookies(home, jar);

  const form = await fetch(BEP_SEARCH_URL, {
    cache: "no-store",
    headers: { ...HEADERS, Cookie: cookieHeader(jar) },
  });
  if (!form.ok) {
    throw new Error(`La BEP a répondu ${form.status} sur le formulaire.`);
  }
  collectCookies(form, jar);

  const formHtml = await form.text();
  const body = buildSearchBody(formHtml, query);
  if (body === undefined) {
    throw new Error(
      "Le formulaire de la BEP ne présente plus les champs attendus " +
        "(txtValor, ucSearch) : le moteur a probablement changé.",
    );
  }

  const results = await fetch(BEP_SEARCH_URL, {
    method: "POST",
    cache: "no-store",
    headers: {
      ...HEADERS,
      Cookie: cookieHeader(jar),
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: BEP_SEARCH_URL,
    },
    body,
  });
  if (!results.ok) {
    throw new Error(`La BEP a répondu ${results.status} à la recherche.`);
  }

  return parseBep(await results.text(), entityPattern);
}
