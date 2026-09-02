import { SATAO_URL } from "@/lib/satao";
import { BEP_SEARCH_URL } from "@/lib/bep";
import { hasFailed, runWatch } from "@/lib/watch";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const dateFormat = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "long",
  timeStyle: "short",
  timeZone: "Europe/Lisbon",
});

const SOURCE_LABELS: Readonly<Record<string, string>> = {
  satao: "plateforme municipale",
  bep: "Bolsa de Emprego Público",
};

export default async function Page() {
  const result = await runWatch();
  const open = result.state === "Aberto";
  // Une source illisible ne permet pas d'affirmer « Fechado » : on ne montre
  // un état du concours que lorsqu'on a de quoi le soutenir.
  const blind = !result.reliable && !open;

  return (
    <main className="page">
      <h1 className="title">satao-watch</h1>
      <p className="lede">
        Procédures concursais de la Câmara Municipal de Sátão, suivies sur la
        plateforme municipale et sur la Bolsa de Emprego Público.
      </p>

      {blind ? (
        <div className="card card--error">
          <p className="cardLabel">État indéterminé</p>
          <p className="cardDetail">
            La surveillance ne parvient pas à lire ses sources. Aucun état ne
            peut être affirmé : une ouverture de candidatures pourrait passer
            inaperçue.
          </p>
        </div>
      ) : (
        <div className={`card ${open ? "card--open" : "card--closed"}`}>
          <p className="cardLabel">État des candidatures</p>
          <p className="state">{result.state}</p>
          <p className="cardDetail">
            {open
              ? "Au moins une procédure accepte des candidatures."
              : "Aucune procédure n'accepte de candidature pour le moment."}
          </p>
        </div>
      )}

      {result.anomalies.length > 0 && (
        <section className="anomalies">
          <h2 className="listTitle">Anomalies</h2>
          <ul>
            {result.anomalies.map((anomaly) => (
              <li key={`${anomaly.source}:${anomaly.kind}`}>
                {anomaly.message}
              </li>
            ))}
          </ul>
        </section>
      )}

      {result.openings.length > 0 && (
        <section className="list">
          <h2 className="listTitle">Ouvertures</h2>
          <ul>
            {result.openings.map((opening) => (
              <li key={opening.key}>
                <a href={opening.url}>{opening.title}</a>
                <span className="meta">
                  {[
                    opening.code,
                    opening.entity,
                    opening.deadline === undefined
                      ? undefined
                      : `jusqu'au ${opening.deadline}`,
                    opening.sources
                      .map((source) => SOURCE_LABELS[source] ?? source)
                      .join(" et "),
                  ]
                    .filter((part) => part !== undefined && part !== "")
                    .join(" · ")}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="sources">
        <h2 className="listTitle">Sources</h2>
        <ul>
          <li>
            <a href={SATAO_URL}>Plateforme municipale</a>{" "}
            {hasFailed(result.satao) ? (
              <span className="badge badge--down">injoignable</span>
            ) : result.satao.recognizable ? (
              <span className="meta">
                {result.satao.processes.length} procédure(s)
              </span>
            ) : (
              <span className="badge badge--down">illisible</span>
            )}
          </li>
          <li>
            <a href={BEP_SEARCH_URL}>Bolsa de Emprego Público</a>{" "}
            {hasFailed(result.bep) ? (
              <span className="badge badge--down">injoignable</span>
            ) : result.bep.recognizable ? (
              <span className="meta">
                {result.bep.offers.length} offre(s) sur {result.bep.rowsSeen}{" "}
                lue(s){result.bep.truncated ? ", résultats tronqués" : ""}
              </span>
            ) : (
              <span className="badge badge--down">illisible</span>
            )}
          </li>
        </ul>
      </section>

      <footer className="footer">
        <p>Vérifié le {dateFormat.format(new Date(result.checkedAt))}.</p>
      </footer>
    </main>
  );
}
