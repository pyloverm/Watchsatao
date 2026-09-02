import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import {
  decodeHtml,
  extractProcesses,
  parseSatao,
  SATAO_URL,
} from "../lib/satao.ts";

const CHECKED_AT = "2026-09-02T08:00:00.000Z";

function fixture(name: string): string {
  return readFileSync(
    fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)),
    "utf8",
  );
}

describe("parseSatao, sur échantillon figé", () => {
  it("lit Fechado quand la page porte l'avis d'absence", () => {
    const result = parseSatao(
      fixture("processos-ativos-fechado.html"),
      CHECKED_AT,
    );

    assert.equal(result.state, "Fechado");
    assert.equal(result.emptyNoticeFound, true);
    assert.deepEqual(result.processes, []);
    assert.equal(result.checkedAt, CHECKED_AT);
  });

  it("lit Aberto quand des procédures sont listées", () => {
    const result = parseSatao(
      fixture("processos-ativos-aberto.html"),
      CHECKED_AT,
    );

    assert.equal(result.state, "Aberto");
    assert.equal(result.emptyNoticeFound, false);
    assert.deepEqual(
      result.processes.map((process) => process.id),
      ["58", "62"],
    );
  });

  it("reste correct sur le balisage brut de /processos-a-decorrer", () => {
    // Même widget WireRecruit, capture non retouchée : garde-fou contre une
    // régression que la fixture assemblée pourrait masquer.
    const result = parseSatao(fixture("processos-a-decorrer.html"), CHECKED_AT);

    assert.equal(result.state, "Aberto");
    assert.equal(result.processes.length, 2);
  });

  it("relève le titre et l'URL absolue de chaque procédure", () => {
    const [first] = parseSatao(
      fixture("processos-ativos-aberto.html"),
      CHECKED_AT,
    ).processes;

    assert.ok(first);
    assert.equal(first.id, "58");
    assert.match(first.title, /Técnico superior/);
    assert.equal(
      first.url,
      "https://recrutamento.cm-satao.pt/processos-ativos/concurso?recruitment_process_id=58",
    );
  });
});

describe("détection de l'avis d'absence", () => {
  const cases: readonly [string, boolean][] = [
    ["Não existem procedimentos concursais ativos.", true],
    // La source capitalise et ponctue ; rien ne garantit qu'elle s'y tienne.
    ["não existem procedimentos concursais ativos", true],
    ["NÃO EXISTEM PROCEDIMENTOS CONCURSAIS ATIVOS", true],
    ["Nao existem  procedimentos\n  concursais   ativos", true],
    ["Existem procedimentos concursais ativos", false],
    ["", false],
  ];

  for (const [html, expected] of cases) {
    it(`${expected ? "reconnaît" : "ignore"} ${JSON.stringify(html.slice(0, 44))}`, () => {
      assert.equal(parseSatao(html, CHECKED_AT).emptyNoticeFound, expected);
    });
  }
});

describe("extractProcesses", () => {
  it("déduplique sur recruitment_process_id", () => {
    // La source rend deux ancres par procédure : l'overlay et le titre.
    const html = `
      <a href="/processos-ativos/concurso?recruitment_process_id=7" aria-label="Une procédure"></a>
      <a href="/processos-ativos/concurso?recruitment_process_id=7"><h3>Une procédure</h3></a>
    `;

    assert.deepEqual(extractProcesses(html), [
      {
        id: "7",
        title: "Une procédure",
        url: "https://recrutamento.cm-satao.pt/processos-ativos/concurso?recruitment_process_id=7",
      },
    ]);
  });

  it("retombe sur l'URL de la source quand le href manque", () => {
    const [only] = extractProcesses(
      '<a data-target="recruitment_process_id=9"></a>',
    );

    assert.ok(only);
    assert.equal(only.url, SATAO_URL);
    assert.equal(only.title, "");
  });

  it("ne retient rien sur une page sans lien de procédure", () => {
    assert.deepEqual(extractProcesses("<ul><li>Rien ici</li></ul>"), []);
  });
});

describe("decodeHtml", () => {
  it("décode les entités numériques", () => {
    assert.equal(decodeHtml("&#x2713; d&#233;j&#224;"), "✓ déjà");
  });

  it("décode les entités nommées du portugais", () => {
    assert.equal(
      decodeHtml("Servi&ccedil;o &amp; Ac&ccedil;&atilde;o S&atilde;o Jo&atilde;o"),
      "Serviço & Acção São João",
    );
  });

  it("distingue la casse des entités accentuées", () => {
    // `&Ccedil;` et `&ccedil;` sont deux caractères différents, alors que
    // `&AMP;` reste une esperluette.
    assert.equal(decodeHtml("&Ccedil;&ccedil; &AMP;"), "Çç &");
  });

  it("laisse intact ce qu'il ne connaît pas", () => {
    assert.equal(decodeHtml("100% &inconnu; ok"), "100% &inconnu; ok");
  });
});
