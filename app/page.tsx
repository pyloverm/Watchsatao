import { SATAO_URL } from "@/lib/satao";
import { BEP_SEARCH_URL } from "@/lib/bep";
import { hasFailed, runWatch } from "@/lib/watch";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const dateFormat = new Intl.DateTimeFormat("pt-PT", {
  dateStyle: "long",
  timeStyle: "short",
  timeZone: "Europe/Lisbon",
});

const SOURCE_LABELS: Readonly<Record<string, string>> = {
  satao: "plataforma municipal",
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
        Procedimentos concursais da Câmara Municipal de Sátão, acompanhados na
        plataforma municipal e na Bolsa de Emprego Público.
      </p>

      {blind ? (
        <div className="card card--error">
          <p className="cardLabel">Estado indeterminado</p>
          <p className="cardDetail">
            A monitorização não consegue ler as suas fontes. Não é possível
            afirmar qualquer estado: uma abertura de candidaturas pode passar
            despercebida.
          </p>
        </div>
      ) : (
        <div className={`card ${open ? "card--open" : "card--closed"}`}>
          <p className="cardLabel">Estado das candidaturas</p>
          <p className="state">{result.state}</p>
          <p className="cardDetail">
            {open
              ? "Pelo menos um procedimento aceita candidaturas."
              : "Nenhum procedimento aceita candidaturas de momento."}
          </p>
        </div>
      )}

      {result.anomalies.length > 0 && (
        <section className="anomalies">
          <h2 className="listTitle">Anomalias</h2>
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
          <h2 className="listTitle">Aberturas</h2>
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
                      : `até ${opening.deadline}`,
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
        <h2 className="listTitle">Fontes</h2>
        <ul>
          <li>
            <a href={SATAO_URL}>Plataforma municipal</a>{" "}
            {hasFailed(result.satao) ? (
              <span className="badge badge--down">inacessível</span>
            ) : result.satao.recognizable ? (
              <span className="meta">
                {result.satao.processes.length} procedimento(s)
              </span>
            ) : (
              <span className="badge badge--down">ilegível</span>
            )}
          </li>
          <li>
            <a href={BEP_SEARCH_URL}>Bolsa de Emprego Público</a>{" "}
            {hasFailed(result.bep) ? (
              <span className="badge badge--down">inacessível</span>
            ) : result.bep.recognizable ? (
              <span className="meta">
                {result.bep.offers.length} oferta(s) em {result.bep.rowsSeen}{" "}
                lida(s){result.bep.truncated ? ", resultados truncados" : ""}
              </span>
            ) : (
              <span className="badge badge--down">ilegível</span>
            )}
          </li>
        </ul>
      </section>

      <footer className="footer">
        <p>Verificado a {dateFormat.format(new Date(result.checkedAt))}.</p>
      </footer>
    </main>
  );
}
