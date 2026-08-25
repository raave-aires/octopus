import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import type { Locator, Page } from "playwright";

import {
  FormStructureError,
  ScoreExtractionError,
  SubmissionUnknownError,
} from "./errors.js";
import { sha256 } from "./runtime.js";
import type {
  AutomationResult,
  ProfileConfig,
  QuizDecision,
  QuizQuestion,
  QuizScore,
  SubmissionRecord,
} from "./types.js";

const REQUIRED_SUFFIX = /\s*Pergunta obrigatória\s*$/iu;
const CONFIRMATION_PATTERN =
  /(Sua resposta foi registrada|Resposta registrada|Your response has been recorded)/iu;
const SCORE_TRIGGER_PATTERN = /(Ver pontua[cç][aã]o|View score)/iu;
const SCORE_PATTERN =
  /(?:Total\s+de\s+pontos|Total\s+points?|Pontua[cç][aã]o\s+total)\s*:?\s*(\d+(?:[.,]\d+)?)\s*\/\s*(\d+(?:[.,]\d+)?)/iu;

export function parseQuizScore(text: string): QuizScore {
  const match = SCORE_PATTERN.exec(text);
  if (!match?.[1] || !match[2]) {
    throw new FormStructureError("A pontuação total não foi encontrada na página de resultado.");
  }

  const earned = Number(match[1].replace(",", "."));
  const total = Number(match[2].replace(",", "."));
  if (!Number.isFinite(earned) || !Number.isFinite(total)) {
    throw new FormStructureError("A pontuação exibida pelo formulário não é numérica.");
  }
  return { earned, total, label: `${match[1]}/${match[2]}` };
}

export function normalizeOptionText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/gu, " ")
    .trim()
    .toUpperCase();
}

function matchesOption(optionName: string, requested: string): boolean {
  return normalizeOptionText(optionName) === normalizeOptionText(requested);
}

async function accessibleName(locator: Locator): Promise<string> {
  const ariaLabel = await locator.getAttribute("aria-label");
  if (ariaLabel?.trim()) return ariaLabel.trim();
  const text = await locator.innerText().catch(() => "");
  return text.trim();
}

async function waitForAttribute(
  locator: Locator,
  name: string,
  expected: string,
  timeout = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if ((await locator.getAttribute(name)) === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new FormStructureError(`O controle não assumiu ${name}=${expected}.`);
}

async function clickRadioByName(page: Page, requested: string): Promise<void> {
  // Mesma tolerância de caixa, acento e espaço aplicada aos seletores, mantendo
  // a exigência de correspondência única.
  const radios = await page.getByRole("radio").all();
  const names = await Promise.all(radios.map(accessibleName));
  const matches = names.flatMap((name, index) => (matchesOption(name, requested) ? [index] : []));
  const target = matches.length === 1 ? radios[matches[0]!] : undefined;
  if (!target) {
    throw new FormStructureError(
      `Esperado um rádio chamado "${requested}", encontrados ${matches.length}. ${names.length} opções lidas: ${names.slice(0, 10).join(" | ") || "nenhuma"}.`,
    );
  }
  await target.click();
  await waitForAttribute(target, "aria-checked", "true");
}

async function selectCustomListbox(
  page: Page,
  questionName: RegExp,
  requested: string,
): Promise<string> {
  const listbox = page.getByRole("listbox", { name: questionName }).first();
  await listbox.waitFor({ state: "visible" });
  await listbox.click();
  await waitForAttribute(listbox, "aria-expanded", "true", 2_000).catch(() => undefined);

  // O formulário lista os itens em caixa alta e sem acentos ("PARAGOMINAS"), então
  // o perfil é resolvido contra o texto real da opção antes de qualquer comparação.
  const optionNames = await Promise.all(
    (await page.locator('[role="option"]').all()).map(accessibleName),
  );
  const value = optionNames.find((name) => matchesOption(name, requested)) ?? requested;

  const selectedOptions = page.locator('[role="option"][aria-selected="true"]');
  const selectedNames = async (): Promise<string[]> =>
    Promise.all((await selectedOptions.all()).map(accessibleName));
  const displaysSelectedValue = async (): Promise<boolean> => {
    const spans = await listbox.locator("span").all();
    if (spans.length === 0) return true;
    for (const span of spans) {
      if ((await span.isVisible()) && (await span.innerText()).trim() === value) return true;
    }
    return false;
  };
  const waitUntilSelected = async (timeout: number): Promise<boolean> => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const menuClosed = (await listbox.getAttribute("aria-expanded")) !== "true";
      if (menuClosed && (await selectedNames()).includes(value) && (await displaysSelectedValue())) {
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return false;
  };

  const semanticOptions = await page.locator('[role="option"]').all();
  const semanticTarget = (
    await Promise.all(
      semanticOptions.map(async (candidate) => ({
        candidate,
        name: await accessibleName(candidate),
      })),
    )
  ).find((item) => item.name === value)?.candidate;
  if (semanticTarget) {
    await semanticTarget.scrollIntoViewIfNeeded();
  }

  const candidates: Locator[] = [];
  for (const candidate of await page.locator("[aria-selected]").all()) {
    if ((await accessibleName(candidate)) === value && (await candidate.isVisible())) {
      candidates.push(candidate);
    }
  }
  const candidateRoles = await Promise.all(
    candidates.map(async (candidate) => ({
      candidate,
      role: await candidate.getAttribute("role"),
    })),
  );
  const visualOption =
    candidateRoles.find((item) => item.role !== "option")?.candidate ??
    candidateRoles.find((item) => item.role === "option")?.candidate;

  if (visualOption) {
    const box = await visualOption.boundingBox();
    if (box) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    } else {
      await visualOption.evaluate((element) => (element as HTMLElement).click());
    }
    if (await waitUntilSelected(2_000)) {
      await page.keyboard.press("Escape");
      return value;
    }
  }

  // Google Forms implements incremental keyboard search on its ARIA listbox.
  if ((await listbox.getAttribute("aria-expanded")) !== "true") {
    await listbox.click();
    await waitForAttribute(listbox, "aria-expanded", "true", 2_000).catch(() => undefined);
  }
  await listbox.focus();
  await page.keyboard.type(value, { delay: 5 });
  await page.keyboard.press("Enter");
  if (await waitUntilSelected(3_000)) {
    await page.keyboard.press("Escape");
    return value;
  }

  const lastSelectedNames = await selectedNames();
  const availableNames = await Promise.all(
    (await page.locator('[role="option"]').all()).map(accessibleName),
  );
  if (!availableNames.some((name) => matchesOption(name, requested))) {
    // Distingue "a opção não está na lista" de "a lista não pôde ser lida".
    throw new FormStructureError(
      `A opção "${requested}" não existe no seletor. ${availableNames.length} opções lidas: ${availableNames.slice(0, 10).join(" | ") || "nenhuma"}.`,
    );
  }
  throw new FormStructureError(
    `A opção "${value}" não permaneceu selecionada (estado: ${lastSelectedNames.join(", ") || "nenhum"}).`,
  );
}

// O Google Forms costuma abrir a pontuação em outra guia, então o resultado é
// procurado em todas as páginas do contexto, não só naquela que foi clicada.
async function findScorePage(page: Page, timeout: number): Promise<{ page: Page; text: string }> {
  const deadline = Date.now() + timeout;
  let inspected: string[] = [];
  while (Date.now() < deadline) {
    inspected = [];
    for (const candidate of page.context().pages()) {
      const text = await candidate.locator("body").innerText().catch(() => "");
      if (SCORE_PATTERN.test(text)) return { page: candidate, text };
      inspected.push(`${candidate.url()} → ${text.replace(/\s+/gu, " ").slice(0, 200) || "sem texto"}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new FormStructureError(
    `A pontuação não apareceu em nenhuma guia após ${timeout}ms. Guias inspecionadas: ${inspected.join(" || ") || "nenhuma"}`,
  );
}

async function advanceTo(page: Page, heading: string): Promise<void> {
  const destination = page.getByRole("heading", { name: heading, exact: true }).first();
  try {
    await Promise.all([
      destination.waitFor({ state: "visible" }),
      page.getByRole("button", { name: "Avançar", exact: true }).click(),
    ]);
  } catch (error) {
    const headings = await page.getByRole("heading").allInnerTexts().catch(() => []);
    const validationText = (await page.locator("body").innerText().catch(() => ""))
      .replace(/\s+/gu, " ")
      .slice(0, 500);
    throw new FormStructureError(
      `Não foi possível avançar para "${heading}". Cabeçalhos: ${headings.join(" | ") || "nenhum"}. Página: ${validationText || "sem conteúdo"}. Causa: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function cleanQuestionText(value: string): string {
  return value.replace(REQUIRED_SUFFIX, "").replace(/\s+/gu, " ").trim();
}

function questionCard(heading: Locator): Locator {
  return heading.locator("xpath=ancestor::*[descendant::*[@role='radio']][1]");
}

export async function extractQuiz(page: Page): Promise<QuizQuestion[]> {
  const headings = await page.getByRole("heading", { level: 3 }).all();
  const questions: QuizQuestion[] = [];

  for (const heading of headings) {
    const card = questionCard(heading);
    const radios = card.getByRole("radio");
    const radioCount = await radios.count();
    if (radioCount === 0) continue;
    if ((await card.getByRole("checkbox").count()) > 0 || (await card.getByRole("textbox").count()) > 0) {
      throw new FormStructureError("O quiz contém um tipo de resposta não suportado.");
    }
    if (radioCount < 2) {
      throw new FormStructureError("Uma pergunta do quiz possui menos de duas alternativas.");
    }

    const prompt = cleanQuestionText(await heading.innerText());
    const options = await Promise.all((await radios.all()).map(accessibleName));
    if (options.some((option) => !option)) {
      throw new FormStructureError("Uma alternativa do quiz não possui nome acessível.");
    }
    questions.push({ id: `q${questions.length + 1}`, prompt, options });
  }

  if (questions.length === 0) {
    throw new FormStructureError("Nenhuma pergunta de múltipla escolha foi encontrada no quiz.");
  }
  return questions;
}

async function applyDecisions(
  page: Page,
  questions: QuizQuestion[],
  decisions: QuizDecision[],
): Promise<void> {
  const headings = await page.getByRole("heading", { level: 3 }).all();
  const cards: Locator[] = [];
  for (const heading of headings) {
    const card = questionCard(heading);
    if ((await card.getByRole("radio").count()) >= 2) cards.push(card);
  }
  if (cards.length !== questions.length) {
    throw new FormStructureError("O quiz mudou enquanto era respondido.");
  }

  for (const decision of decisions) {
    const questionIndex = questions.findIndex((question) => question.id === decision.questionId);
    const question = questions[questionIndex];
    const card = cards[questionIndex];
    if (!question || !card) throw new FormStructureError(`Pergunta não encontrada: ${decision.questionId}.`);
    const option = question.options[decision.optionIndex];
    if (!option) throw new FormStructureError(`Alternativa não encontrada: ${decision.questionId}.`);
    const radio = card.getByRole("radio", { name: option, exact: true });
    await radio.click();
    await waitForAttribute(radio, "aria-checked", "true");
  }
}

async function saveScreenshot(page: Page, directory: string, name: string): Promise<void> {
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: join(directory, name), fullPage: true });
}

export async function runGoogleForm(options: {
  page: Page;
  url: string;
  profile: ProfileConfig;
  dryRun: boolean;
  weekKey: string;
  screenshotDirectory: string;
  solve: (theme: string, questions: QuizQuestion[]) => Promise<QuizDecision[]>;
  now?: () => Date;
  confirmationTimeoutMs?: number;
  scoreTimeoutMs?: number;
}): Promise<AutomationResult> {
  const { page, profile } = options;
  const now = options.now ?? (() => new Date());
  page.setDefaultTimeout(15_000);
  await page.goto(options.url, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { level: 1 }).waitFor({ state: "visible" });

  if ((await page.getByRole("button", { name: "Avançar", exact: true }).count()) === 0) {
    throw new FormStructureError("O formulário não está acessível anonimamente ou não possui o fluxo esperado.");
  }

  const themeRadios = page.getByRole("radio");
  if ((await themeRadios.count()) !== 1) {
    throw new FormStructureError("A página inicial deve possuir exatamente uma opção de tema.");
  }
  const themeRadio = themeRadios.first();
  const theme = await accessibleName(themeRadio);
  await themeRadio.click();
  await waitForAttribute(themeRadio, "aria-checked", "true");

  await page.getByRole("textbox", { name: /NOME COMPLETO/iu }).fill(profile.fullName);
  await page.getByRole("textbox", { name: /MATR[IÍ]CULA/iu }).fill(profile.employeeId);
  await selectCustomListbox(page, /CIDADE ONDE TRABALHA/iu, profile.city);
  await advanceTo(page, "EMPRESA");

  await clickRadioByName(page, profile.employmentType);
  await advanceTo(page, "FORNECEDOR");

  await selectCustomListbox(page, /^EMPRESA/iu, profile.supplier);
  await advanceTo(page, "REGIONAL");

  // A página seguinte é intitulada com a regional na grafia do formulário, que
  // não é necessariamente a do perfil.
  const region = await selectCustomListbox(page, /QUAL REGIONAL/iu, profile.region);
  await advanceTo(page, region);

  await selectCustomListbox(page, /GERENTE EQUATORIAL/iu, profile.manager);
  await advanceTo(page, "FRENTE DE ATUAÇÃO");

  await clickRadioByName(page, profile.workArea);
  await advanceTo(page, "QUIZ");

  const questions = await extractQuiz(page);
  const decisions = await options.solve(theme, questions);
  await applyDecisions(page, questions, decisions);
  await saveScreenshot(page, options.screenshotDirectory, "pre-submit.png");

  const baseRecord: Omit<SubmissionRecord, "status" | "submittedAt"> = {
    version: 1,
    weekKey: options.weekKey,
    urlHash: sha256(options.url),
    theme,
    questionCount: questions.length,
  };

  if (options.dryRun) {
    return {
      record: { ...baseRecord, status: "dry-run", submittedAt: now().toISOString() },
      questions,
      decisions,
    };
  }

  await page.getByRole("button", { name: "Enviar", exact: true }).click();
  let confirmationText: string;
  try {
    const confirmation = page.getByText(CONFIRMATION_PATTERN).first();
    await confirmation.waitFor({ state: "visible", timeout: options.confirmationTimeoutMs ?? 15_000 });
    confirmationText = (await confirmation.innerText()).trim();
    await saveScreenshot(page, options.screenshotDirectory, "confirmation.png");
  } catch (error) {
    await saveScreenshot(page, options.screenshotDirectory, "submission-unknown.png").catch(() => undefined);
    throw new SubmissionUnknownError(
      `O botão Enviar foi acionado, mas a confirmação não apareceu: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const confirmedResult: AutomationResult = {
    record: {
      ...baseRecord,
      status: "success",
      submittedAt: now().toISOString(),
      confirmationText,
    },
    questions,
    decisions,
  };

  try {
    const timeout = options.scoreTimeoutMs ?? 15_000;
    const trigger = page
      .getByRole("button", { name: SCORE_TRIGGER_PATTERN })
      .or(page.getByRole("link", { name: SCORE_TRIGGER_PATTERN }))
      .first();
    await trigger.waitFor({ state: "visible", timeout });
    await trigger.click();

    const found = await findScorePage(page, timeout);
    const score = parseQuizScore(found.text);
    await saveScreenshot(found.page, options.screenshotDirectory, "score.png");
    return {
      ...confirmedResult,
      record: { ...confirmedResult.record, score },
    };
  } catch (error) {
    await saveScreenshot(page, options.screenshotDirectory, "score-unavailable.png").catch(
      () => undefined,
    );
    throw new ScoreExtractionError(
      `O envio foi confirmado, mas a pontuação não pôde ser lida: ${error instanceof Error ? error.message : String(error)}`,
      confirmedResult,
    );
  }
}
