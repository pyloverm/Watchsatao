import { fetchSatao, SATAO_URL, type SataoResult } from "@/lib/satao";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const dateFormat = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "long",
  timeStyle: "short",
  timeZone: "Europe/Lisbon",
});

async function load(): Promise<SataoResult | Error> {
  try {
    return await fetchSatao();
  } catch (error: unknown) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

export default async function Page() {
  const result = await load();

  if (result instanceof Error) {
    return (
      <main className="page">
        <h1 className="title">satao-watch</h1>
        <p className="lede">
          Procédures concursais de la Câmara Municipal de Sátão.
        </p>
        <div className="card card--error">
          <p className="cardLabel">Source injoignable</p>
          <p className="cardDetail">{result.message}</p>
        </div>
      </main>
    );
  }

  const open = result.state === "Aberto";

  return (
    <main className="page">
      <h1 className="title">satao-watch</h1>
      <p className="lede">
        Procédures concursais de la Câmara Municipal de Sátão.
      </p>

      <div className={`card ${open ? "card--open" : "card--closed"}`}>
        <p className="cardLabel">État des candidatures</p>
        <p className="state">{result.state}</p>
        <p className="cardDetail">
          {open
            ? "Au moins une procédure accepte des candidatures."
            : "Aucune procédure n'accepte de candidature pour le moment."}
        </p>
      </div>

      {result.processes.length > 0 && (
        <section className="list">
          <h2 className="listTitle">Procédures ouvertes</h2>
          <ul>
            {result.processes.map((process) => (
              <li key={process.id}>
                <a href={process.url}>
                  {process.title || `Procédure ${process.id}`}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer className="footer">
        <p>Vérifié le {dateFormat.format(new Date(result.checkedAt))}.</p>
        <p>
          <a href={SATAO_URL}>Consulter la source</a>
        </p>
      </footer>
    </main>
  );
}
