import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { after, before, test } from "node:test";

import { chromium, type Browser } from "playwright";

import { FormStructureError, ScoreExtractionError, SubmissionUnknownError } from "../../src/errors.js";
import { runGoogleForm } from "../../src/google-form.js";
import type { ProfileConfig, QuizDecision, QuizQuestion } from "../../src/types.js";

const fixturePath = fileURLToPath(new URL("../fixtures/google-form.html", import.meta.url));
const fixtureUrl = pathToFileURL(fixturePath).href;
const profile: ProfileConfig = {
  fullName: "Raave de Lima Aires",
  employeeId: "1554",
  city: "PARAGOMINAS",
  employmentType: "PARCEIRA",
  supplier: "ELINSA ELETROTÉCNICA INDUSTRIAL E NAVAL DO BRASIL LTDA",
  region: "NORDESTE",
  manager: "JANILSON SAMPAIO DE OLIVEIRA",
  workArea: "Administrativo (Escritório) – apoio, análise e suporte aos processos",
};

let browser: Browser;

before(async () => {
  browser = await chromium.launch({ headless: true });
});

after(async () => {
  await browser.close();
});

function logicalSolver(_theme: string, questions: QuizQuestion[]): Promise<QuizDecision[]> {
  assert.equal(questions.length, 3);
  return Promise.resolve([1, 2, 2].map((optionIndex, index) => ({
    questionId: `q${index + 1}`,
    optionIndex,
    rationale: "Alternativa logicamente correta.",
  })));
}

test("preenche as seis páginas, escolhe B/C/C e para antes de enviar no dry-run", async () => {
  const page = await browser.newPage();
  const screenshotDirectory = await mkdtemp(join(tmpdir(), "dsc-dry-run-"));
  const result = await runGoogleForm({
    page,
    url: fixtureUrl,
    profile,
    dryRun: true,
    weekKey: "2026-W33",
    screenshotDirectory,
    solve: logicalSolver,
  });

  assert.equal(result.record.status, "dry-run");
  assert.equal(result.record.questionCount, 3);
  assert.deepEqual(result.decisions.map((decision) => decision.optionIndex), [1, 2, 2]);
  assert.equal(await page.getByRole("button", { name: "Enviar" }).isVisible(), true);
  await page.close();
});

test("resolve opções mesmo com caixa, acento e espaço diferentes do perfil", async () => {
  const page = await browser.newPage();
  const screenshotDirectory = await mkdtemp(join(tmpdir(), "dsc-normalizado-"));
  const result = await runGoogleForm({
    page,
    url: fixtureUrl,
    profile: {
      ...profile,
      // O formulário lista tudo em caixa alta; o perfil aqui diverge de propósito.
      city: "Paragominas",
      supplier: "Elinsa  Eletrotecnica Industrial e Naval do Brasil Ltda",
      region: "nordeste",
      manager: "Janilson Sampaio de Oliveira",
      employmentType: "Parceira",
    },
    dryRun: false,
    weekKey: "2026-W33",
    screenshotDirectory,
    solve: logicalSolver,
  });

  assert.equal(result.record.status, "success");
  await page.close();
});

test("falha com a lista de opções lidas quando o valor não existe", async () => {
  const page = await browser.newPage();
  const screenshotDirectory = await mkdtemp(join(tmpdir(), "dsc-inexistente-"));

  await assert.rejects(
    () => runGoogleForm({
      page,
      url: fixtureUrl,
      profile: { ...profile, city: "CIDADE INEXISTENTE" },
      dryRun: true,
      weekKey: "2026-W33",
      screenshotDirectory,
      solve: logicalSolver,
    }),
    (error: unknown) => {
      assert.ok(error instanceof FormStructureError);
      assert.match(error.message, /não existe no seletor/u);
      assert.match(error.message, /PARAGOMINAS/u);
      return true;
    },
  );
  await page.close();
});

test("só retorna sucesso após a confirmação e inclui a pontuação", async () => {
  const page = await browser.newPage();
  const screenshotDirectory = await mkdtemp(join(tmpdir(), "dsc-success-"));
  const result = await runGoogleForm({
    page,
    url: fixtureUrl,
    profile,
    dryRun: false,
    weekKey: "2026-W33",
    screenshotDirectory,
    solve: logicalSolver,
  });

  assert.equal(result.record.status, "success");
  assert.match(result.record.confirmationText ?? "", /registrada/u);
  assert.deepEqual(result.record.score, { earned: 10, total: 10, label: "10/10" });
  await page.close();
});

test("lê a pontuação quando o formulário a abre em outra guia", async () => {
  const context = await browser.newContext();
  await context.addInitScript(() => {
    (window as Window & { SCORE_IN_NEW_TAB?: boolean }).SCORE_IN_NEW_TAB = true;
  });
  const page = await context.newPage();
  const screenshotDirectory = await mkdtemp(join(tmpdir(), "dsc-nova-guia-"));
  const result = await runGoogleForm({
    page,
    url: fixtureUrl,
    profile,
    dryRun: false,
    weekKey: "2026-W33",
    screenshotDirectory,
    solve: logicalSolver,
  });

  assert.equal(result.record.status, "success");
  assert.deepEqual(result.record.score, { earned: 10, total: 10, label: "10/10" });
  await context.close();
});

test("aceita 'Pontuação total' como redação alternativa", async () => {
  const context = await browser.newContext();
  await context.addInitScript(() => {
    (window as Window & { SCORE_WORDING?: string }).SCORE_WORDING = "Pontuação total:";
  });
  const page = await context.newPage();
  const screenshotDirectory = await mkdtemp(join(tmpdir(), "dsc-redacao-"));
  const result = await runGoogleForm({
    page,
    url: fixtureUrl,
    profile,
    dryRun: false,
    weekKey: "2026-W33",
    screenshotDirectory,
    solve: logicalSolver,
  });

  assert.deepEqual(result.record.score, { earned: 10, total: 10, label: "10/10" });
  await context.close();
});

test("preserva o sucesso quando a confirmação aparece, mas a nota não pode ser lida", async () => {
  const context = await browser.newContext();
  await context.addInitScript(() => {
    (window as Window & { NO_SCORE?: boolean }).NO_SCORE = true;
  });
  const page = await context.newPage();
  const screenshotDirectory = await mkdtemp(join(tmpdir(), "dsc-score-unavailable-"));

  await assert.rejects(
    () => runGoogleForm({
      page,
      url: fixtureUrl,
      profile,
      dryRun: false,
      weekKey: "2026-W33",
      screenshotDirectory,
      solve: logicalSolver,
      scoreTimeoutMs: 100,
    }),
    (error: unknown) => {
      assert.ok(error instanceof ScoreExtractionError);
      assert.equal(error.result.record.status, "success");
      assert.match(error.result.record.confirmationText ?? "", /registrada/u);
      return true;
    },
  );
  await context.close();
});

test("classifica como incerto quando o clique não produz confirmação", async () => {
  const context = await browser.newContext();
  await context.addInitScript(() => {
    (window as Window & { NO_CONFIRMATION?: boolean }).NO_CONFIRMATION = true;
  });
  const page = await context.newPage();
  const screenshotDirectory = await mkdtemp(join(tmpdir(), "dsc-unknown-"));

  await assert.rejects(
    () => runGoogleForm({
      page,
      url: fixtureUrl,
      profile,
      dryRun: false,
      weekKey: "2026-W33",
      screenshotDirectory,
      solve: logicalSolver,
      confirmationTimeoutMs: 100,
    }),
    SubmissionUnknownError,
  );
  await context.close();
});
