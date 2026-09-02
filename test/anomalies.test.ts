import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { parseSatao } from "../lib/satao.ts";
import { parseBep } from "../lib/bep.ts";
import { anomalySignature, inspect, type Anomaly } from "../lib/watch.ts";

function fixture(name: string): string {
  return readFileSync(
    fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)),
    "utf8",
  );
}

const CHECKED_AT = "2026-09-02T08:00:00.000Z";

describe("détection d'un parsing hors service", () => {
  it("tient pour lisible une page fermée", () => {
    const result = parseSatao(
      fixture("processos-ativos-fechado.html"),
      CHECKED_AT,
    );

    assert.equal(result.recognizable, true);
    assert.equal(inspect("satao", result), undefined);
  });

  it("tient pour lisible une page ouverte", () => {
    const result = parseSatao(
      fixture("processos-ativos-aberto.html"),
      CHECKED_AT,
    );

    assert.equal(result.recognizable, true);
    assert.equal(inspect("satao", result), undefined);
  });

  it("signale une page refondue au lieu de la dire Fechado", () => {
    // La régression que l'on refuse : Wiremaze change la page, plus aucun
    // signal n'est reconnu, et l'app afficherait « Fechado » pour toujours.
    const refonte =
      "<html><body><h1>Recrutamento</h1><div class='novo-widget'>" +
      "<p>Consulte as nossas oportunidades.</p></div></body></html>";
    const result = parseSatao(refonte, CHECKED_AT);

    assert.equal(result.state, "Fechado");
    assert.equal(result.recognizable, false);

    const anomaly = inspect("satao", result);
    assert.ok(anomaly, "aucune anomalie relevée sur une page illisible");
    assert.equal(anomaly.kind, "unrecognized");
    assert.match(anomaly.message, /plataforma municipal/);
  });

  it("signale une source muette", () => {
    const anomaly = inspect("bep", {
      failed: true,
      message: "La BEP a répondu 503 sur l'accueil.",
    });

    assert.ok(anomaly);
    assert.equal(anomaly.kind, "unreachable");
    assert.match(anomaly.message, /503/);
  });
});

describe("lisibilité de la BEP", () => {
  it("tient pour lisible une grille sans offre de Sátão", () => {
    // Zéro offre retenue, mais dix lignes lues : la page est comprise.
    const result = parseBep(fixture("bep-resultats.html"));

    assert.deepEqual(result.offers, []);
    assert.equal(result.rowsSeen, 10);
    assert.equal(result.recognizable, true);
  });

  it("tient pour lisible un avis d'absence d'offre", () => {
    const result = parseBep(fixture("bep-aucun-resultat.html"));

    assert.equal(result.rowsSeen, 0);
    assert.equal(result.recognizable, true);
  });

  it("signale un moteur qui répond autre chose", () => {
    const result = parseBep("<html><body>Manutenção em curso</body></html>");

    assert.equal(result.rowsSeen, 0);
    assert.equal(result.recognizable, false);
    assert.equal(inspect("bep", result)?.kind, "unrecognized");
  });
});

describe("anomalySignature", () => {
  const anomaly = (over: Partial<Anomaly>): Anomaly => ({
    source: "satao",
    kind: "unrecognized",
    message: "peu importe",
    ...over,
  });

  it("est vide quand tout va bien", () => {
    assert.equal(anomalySignature([]), "");
  });

  it("ne dépend ni de l'ordre ni du message", () => {
    const a = anomalySignature([
      anomaly({ source: "bep", kind: "unreachable" }),
      anomaly({ source: "satao" }),
    ]);
    const b = anomalySignature([
      anomaly({ source: "satao", message: "autre texte" }),
      anomaly({ source: "bep", kind: "unreachable" }),
    ]);

    assert.equal(a, b);
    assert.equal(a, "bep:unreachable|satao:unrecognized");
  });

  it("change quand la nature de l'anomalie change", () => {
    assert.notEqual(
      anomalySignature([anomaly({ kind: "unrecognized" })]),
      anomalySignature([anomaly({ kind: "unreachable" })]),
    );
  });
});
