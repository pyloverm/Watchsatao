import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { mergeOpenings } from "../lib/watch.ts";
import type { SataoProcess } from "../lib/satao.ts";
import type { BepOffer } from "../lib/bep.ts";

const sataoProcess = (over: Partial<SataoProcess> = {}): SataoProcess => ({
  id: "58",
  title: "P/2025 - Técnico superior",
  url: "https://recrutamento.cm-satao.pt/processos-ativos/concurso?recruitment_process_id=58",
  ...over,
});

const bepOffer = (over: Partial<BepOffer> = {}): BepOffer => ({
  code: "OE202507/1239",
  entity: "Câmara Municipal de Sátão",
  type: "Procedimento Concursal Comum",
  career: "Técnico Superior",
  district: "Viseu",
  deadline: "2026-09-16",
  ...over,
});

describe("mergeOpenings", () => {
  it("fond en une seule ouverture les deux vues d'une même offre", () => {
    const merged = mergeOpenings(
      [sataoProcess({ bepCode: "OE202507/1239" })],
      [bepOffer()],
    );

    assert.equal(merged.length, 1);
    const [only] = merged;
    assert.ok(only);
    assert.deepEqual([...only.sources].sort(), ["bep", "satao"]);
    assert.equal(only.code, "OE202507/1239");
    // La source municipale intitule mieux et donne une URL par procédure.
    assert.match(only.title, /P\/2025/);
    assert.match(only.url, /recruitment_process_id=58/);
    // La BEP apporte ce que la source municipale ne liste pas.
    assert.equal(only.entity, "Câmara Municipal de Sátão");
    assert.equal(only.deadline, "2026-09-16");
  });

  it("garde distinctes deux offres de codes différents", () => {
    const merged = mergeOpenings(
      [sataoProcess({ bepCode: "OE202507/1239" })],
      [bepOffer({ code: "OE202606/1853" })],
    );

    assert.equal(merged.length, 2);
  });

  it("ne fond pas une procédure municipale dont le code BEP est inconnu", () => {
    // Mieux vaut un doublon qu'une ouverture avalée par une fausse égalité.
    const merged = mergeOpenings([sataoProcess()], [bepOffer()]);

    assert.equal(merged.length, 2);
    assert.deepEqual(
      merged.map((opening) => opening.key).sort(),
      ["OE202507/1239", "satao:58"],
    );
  });

  it("déduplique deux procédures municipales de même code BEP", () => {
    const merged = mergeOpenings(
      [
        sataoProcess({ bepCode: "OE202507/1239" }),
        sataoProcess({ id: "59", bepCode: "OE202507/1239" }),
      ],
      [],
    );

    assert.equal(merged.length, 1);
  });

  it("intitule une offre BEP seule par sa carrière et son type", () => {
    const [only] = mergeOpenings([], [bepOffer()]);

    assert.ok(only);
    assert.deepEqual(only.sources, ["bep"]);
    assert.equal(only.title, "Técnico Superior — Procedimento Concursal Comum");
  });

  it("ne rend rien quand aucune source n'annonce d'ouverture", () => {
    assert.deepEqual(mergeOpenings([], []), []);
  });
});
