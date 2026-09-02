/**
 * Fusion des deux sources.
 *
 * La plateforme municipale et la Bolsa de Emprego Público annoncent les mêmes
 * procédures, souvent à quelques jours d'écart, la BEP la première. Le seul
 * identifiant commun est le code d'offre BEP : la source municipale le porte
 * dans le corps de ses fiches, sous « Código da BEP ». C'est donc lui, et lui
 * seul, qui permet de ne pas annoncer deux fois la même ouverture.
 */

import {
  fetchBep,
  type BepOffer,
  type BepResult,
  BEP_SEARCH_URL,
} from "./bep.ts";
import {
  fetchBepCode,
  fetchSatao,
  type ContestState,
  type SataoProcess,
  type SataoResult,
} from "./satao.ts";

export type SourceName = "satao" | "bep";

export interface Opening {
  /** Code BEP quand il est connu, identité municipale sinon. */
  readonly key: string;
  readonly code: string | undefined;
  readonly title: string;
  readonly url: string;
  readonly entity: string | undefined;
  readonly deadline: string | undefined;
  /** Sources qui annoncent cette ouverture. */
  readonly sources: readonly SourceName[];
}

/** Une source qui n'a pas répondu. L'autre reste exploitable. */
export interface SourceFailure {
  readonly failed: true;
  readonly message: string;
}

export function hasFailed<T extends object>(
  value: T | SourceFailure,
): value is SourceFailure {
  return "failed" in value;
}

/**
 * Ce qui empêche de croire le résultat.
 *
 * `unreachable` : la source n'a pas répondu. Bruyant par nature, la requête
 * ayant échoué.
 * `unrecognized` : la source a répondu, mais sa page n'est plus lisible. C'est
 * le cas dangereux : sans ce signal, l'app afficherait « Fechado » pour
 * toujours après une refonte, sans que rien ne le signale.
 */
export type AnomalyKind = "unreachable" | "unrecognized";

export interface Anomaly {
  readonly source: SourceName;
  readonly kind: AnomalyKind;
  readonly message: string;
}

export interface WatchResult {
  readonly state: ContestState;
  readonly openings: readonly Opening[];
  readonly satao: SataoResult | SourceFailure;
  readonly bep: BepResult | SourceFailure;
  /** Vide quand les deux sources ont répondu et ont été comprises. */
  readonly anomalies: readonly Anomaly[];
  /**
   * Faux dès qu'une source est muette ou illisible : `state` ne vaut alors
   * pas mieux qu'une supposition et ne doit pas être affiché tel quel.
   */
  readonly reliable: boolean;
  readonly checkedAt: string;
}

const SOURCE_TITLES: Readonly<Record<SourceName, string>> = {
  satao: "la plateforme municipale de Sátão",
  bep: "la Bolsa de Emprego Público",
};

/** Relève ce qui cloche dans une source, muette comme illisible. */
export function inspect(
  source: SourceName,
  result: { readonly recognizable: boolean } | SourceFailure,
): Anomaly | undefined {
  const title = SOURCE_TITLES[source];

  if (hasFailed(result)) {
    return {
      source,
      kind: "unreachable",
      message: `${title} n'a pas répondu : ${result.message}`,
    };
  }

  if (!result.recognizable) {
    return {
      source,
      kind: "unrecognized",
      message:
        `${title} a répondu, mais aucun des signaux attendus n'a été ` +
        "reconnu dans sa page. Le parsing est probablement à refaire : tant " +
        "qu'il ne l'est pas, une ouverture peut passer inaperçue.",
    };
  }

  return undefined;
}

/** Signature stable des anomalies, pour ne pas réalerter à l'identique. */
export function anomalySignature(anomalies: readonly Anomaly[]): string {
  return [...anomalies]
    .map((anomaly) => `${anomaly.source}:${anomaly.kind}`)
    .sort()
    .join("|");
}

function fromSatao(process: SataoProcess): Opening {
  return {
    key: process.bepCode ?? `satao:${process.id}`,
    code: process.bepCode,
    title: process.title || `Procédure ${process.id}`,
    url: process.url,
    entity: undefined,
    deadline: undefined,
    sources: ["satao"],
  };
}

function fromBep(offer: BepOffer): Opening {
  return {
    key: offer.code,
    code: offer.code,
    // La BEP n'expose pas d'URL par offre : le détail passe par un postback
    // ASP.NET, donc rien de citable. On renvoie vers la recherche.
    title: [offer.career, offer.type].filter(Boolean).join(" — ") || offer.code,
    url: BEP_SEARCH_URL,
    entity: offer.entity,
    deadline: offer.deadline,
    sources: ["bep"],
  };
}

/** Fusionne deux ouvertures désignant la même offre. */
function combine(existing: Opening, incoming: Opening): Opening {
  const sources = [...new Set([...existing.sources, ...incoming.sources])];
  return {
    key: existing.key,
    code: existing.code ?? incoming.code,
    // La source municipale intitule mieux que la grille de la BEP.
    title: existing.sources.includes("satao") ? existing.title : incoming.title,
    // Et elle seule donne une URL par procédure.
    url: existing.sources.includes("satao") ? existing.url : incoming.url,
    entity: existing.entity ?? incoming.entity,
    deadline: existing.deadline ?? incoming.deadline,
    sources,
  };
}

/**
 * Fusionne les ouvertures des deux sources en dédupliquant sur le code
 * d'offre. Une procédure municipale sans code BEP connu reste distincte :
 * mieux vaut un doublon qu'une ouverture avalée par une fausse égalité.
 */
export function mergeOpenings(
  sataoProcesses: readonly SataoProcess[],
  bepOffers: readonly BepOffer[],
): Opening[] {
  const merged = new Map<string, Opening>();

  for (const opening of [
    ...sataoProcesses.map(fromSatao),
    ...bepOffers.map(fromBep),
  ]) {
    const existing = merged.get(opening.key);
    merged.set(
      opening.key,
      existing === undefined ? opening : combine(existing, opening),
    );
  }

  return [...merged.values()];
}

function describe(error: unknown): SourceFailure {
  return {
    failed: true,
    message: error instanceof Error ? error.message : String(error),
  };
}

/**
 * Interroge les deux sources et fusionne. Les deux appels sont indépendants :
 * une source en panne n'empêche pas l'autre de déclencher l'alerte.
 */
export async function runWatch(): Promise<WatchResult> {
  const [sataoSettled, bepSettled] = await Promise.allSettled([
    fetchSatao(),
    fetchBep(),
  ]);

  const satao: SataoResult | SourceFailure =
    sataoSettled.status === "fulfilled"
      ? sataoSettled.value
      : describe(sataoSettled.reason);
  const bep: BepResult | SourceFailure =
    bepSettled.status === "fulfilled"
      ? bepSettled.value
      : describe(bepSettled.reason);

  // Les codes BEP ne vivent que dans les fiches : une requête par procédure,
  // et il n'y en a jamais qu'une poignée.
  const sataoProcesses: SataoProcess[] = hasFailed(satao)
    ? []
    : await Promise.all(
        satao.processes.map(async (process): Promise<SataoProcess> => {
          const bepCode = await fetchBepCode(process.url);
          return bepCode === undefined ? process : { ...process, bepCode };
        }),
      );

  const bepOffers = hasFailed(bep) ? [] : bep.offers;
  const openings = mergeOpenings(sataoProcesses, bepOffers);

  const anomalies = [inspect("satao", satao), inspect("bep", bep)].filter(
    (anomaly): anomaly is Anomaly => anomaly !== undefined,
  );

  return {
    state: openings.length > 0 ? "Aberto" : "Fechado",
    openings,
    satao,
    bep,
    anomalies,
    reliable: anomalies.length === 0,
    checkedAt: new Date().toISOString(),
  };
}
