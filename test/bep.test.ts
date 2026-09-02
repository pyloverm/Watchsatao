import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { buildSearchBody, fold, hiddenField, parseBep } from "../lib/bep.ts";
import { extractBepCode } from "../lib/satao.ts";

function fixture(name: string): string {
  return readFileSync(
    fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)),
    "utf8",
  );
}

const TOUTES = /./;

describe("parseBep, sur échantillon figé", () => {
  it("lit la grille complète d'une recherche fructueuse", () => {
    const result = parseBep(fixture("bep-resultats.html"), TOUTES);

    assert.equal(result.offers.length, 10);
    assert.equal(result.emptyNoticeFound, false);
  });

  it("relève toutes les colonnes d'une offre", () => {
    const [first] = parseBep(fixture("bep-resultats.html"), TOUTES).offers;

    assert.deepEqual(first, {
      code: "OE202609/0087",
      entity: "Câmara Municipal de Carregal do Sal",
      type: "Procedimento Concursal Comum",
      career: "Técnico Superior",
      district: "Viseu",
      deadline: "2026-09-16",
    });
  });

  it("signale la pagination plutôt que de tronquer en silence", () => {
    assert.equal(parseBep(fixture("bep-resultats.html"), TOUTES).truncated, true);
  });

  it("écarte les entités qui ne sont pas celle visée", () => {
    // La recherche libre est large : aucune des dix mairies n'est Sátão.
    assert.deepEqual(parseBep(fixture("bep-resultats.html")).offers, []);
  });

  it("reconnaît l'avis d'absence d'offre", () => {
    const result = parseBep(fixture("bep-aucun-resultat.html"));

    assert.equal(result.emptyNoticeFound, true);
    assert.deepEqual(result.offers, []);
    assert.equal(result.truncated, false);
  });

  it("retient l'entité visée quelle que soit sa dénomination", () => {
    // La BEP écrit « Câmara Municipal de Sátão », la passation parlait de
    // « Município de Sátão » : les deux doivent passer.
    for (const entity of [
      "Câmara Municipal de Sátão",
      "Município de Sátão",
      "MUNICIPIO DE SATAO",
    ]) {
      const row =
        `<table><tr><td>OE202609/0001</td><td>Comum</td><td>CTFP</td>` +
        `<td>Técnico Superior</td><td>Técnico Superior</td><td>Viseu</td>` +
        `<td>${entity}</td><td>Licenciatura</td><td>2026-09-16</td></tr></table>`;

      assert.equal(parseBep(row).offers.length, 1, entity);
    }
  });
});

describe("fold", () => {
  it("replie accents et casse", () => {
    assert.equal(fold("Sátão"), "satao");
    assert.equal(fold("SÁTÃO"), "satao");
    assert.equal(fold("Câmara Municipal"), "camara municipal");
  });
});

describe("formulaire ASP.NET", () => {
  it("lit le ViewState du formulaire", () => {
    const form = fixture("bep-formulaire.html");

    assert.equal(hiddenField(form, "__VIEWSTATE"), "VIEWSTATE-FIXTURE-ABREGE");
    assert.equal(hiddenField(form, "__VIEWSTATEGENERATOR"), "F7CA85E8");
  });

  it("compose le POST à partir des noms de champs réellement présents", () => {
    const body = buildSearchBody(fixture("bep-formulaire.html"), "Sátão");

    assert.ok(body);
    assert.equal(body.get("__VIEWSTATE"), "VIEWSTATE-FIXTURE-ABREGE");
    // Le préfixe ctl00$… est relevé dans la page, jamais codé en dur.
    const champ = [...body.keys()].find((key) => key.endsWith("$txtValor"));
    assert.ok(champ, "champ de recherche introuvable");
    assert.equal(body.get(champ), "Sátão");
    assert.ok([...body.keys()].some((key) => key.endsWith("$ucSearch")));
  });

  it("renonce quand le formulaire n'a plus les champs attendus", () => {
    // Signal que le moteur a changé : mieux vaut échouer que poster à vide.
    assert.equal(buildSearchBody("<form></form>", "Sátão"), undefined);
  });
});

describe("extractBepCode", () => {
  it("lit le code BEP d'une fiche municipale réelle", () => {
    assert.equal(
      extractBepCode(fixture("satao-fiche-avec-code-bep.html")),
      "OE202507/1239",
    );
  });

  it("ne rend rien quand la fiche n'en porte pas", () => {
    assert.equal(extractBepCode("<p>Sans code</p>"), undefined);
  });
});
