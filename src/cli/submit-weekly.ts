import { mkdir, rm, writeFile } from "node:fs/promises";

import "dotenv/config";
import { chromium } from "playwright";

import { getGeminiApiKey, getGeminiModel, loadProfile } from "../config.js";
import { ScoreExtractionError, SubmissionUnknownError } from "../errors.js";
import { createGeminiGenerator, solveQuiz } from "../gemini.js";
import { runGoogleForm } from "../google-form.js";
import { assertRecentLink } from "../link-state.js";
import {
  errorMessage,
  getIsoWeekKey,
  parseBoolean,
  readJson,
  sanitizeForTelegram,
  setGitHubOutput,
  sha256,
  writeJson,
} from "../runtime.js";
import { buildCompletionNotification, formatSaoPauloTime } from "../submission-message.js";
import { normalizeFormUrl } from "../telegram.js";
import type { StoredFormLink, SubmissionRecord, SubmissionStatus } from "../types.js";

const OUTPUT_DIRECTORY = "output";

async function resolveUrl(): Promise<string> {
  const override = process.env.FORM_URL_OVERRIDE?.trim();
  if (override) return normalizeFormUrl(override);

  const storedLink = await readJson<StoredFormLink>(
    process.env.FORM_LINK_PATH?.trim() || ".state/link/form-link.json",
  );
  assertRecentLink(storedLink);
  return normalizeFormUrl(storedLink.url);
}

async function recordStatus(status: SubmissionStatus, weekKey: string): Promise<void> {
  await setGitHubOutput("status", status);
  await setGitHubOutput("week_key", weekKey);
  await setGitHubOutput("evidence_name", `dsc-run-${weekKey}-${process.env.GITHUB_RUN_ID ?? "local"}`);
  if (status === "success" || status === "unknown") {
    await setGitHubOutput("marker_name", `dsc-${status}-${weekKey}`);
  }
}

async function main(): Promise<void> {
  await rm(OUTPUT_DIRECTORY, { recursive: true, force: true });
  await mkdir(OUTPUT_DIRECTORY, { recursive: true });
  const weekKey = process.env.WEEK_KEY?.trim() || getIsoWeekKey();
  const dryRun = parseBoolean(process.env.DRY_RUN);
  let url = "";

  try {
    url = await resolveUrl();
    const profile = loadProfile();
    const generateJson = createGeminiGenerator({
      apiKey: getGeminiApiKey(),
      model: getGeminiModel(),
    });
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({
        locale: "pt-BR",
        timezoneId: "America/Sao_Paulo",
        viewport: { width: 1365, height: 900 },
      });
      const page = await context.newPage();
      const result = await runGoogleForm({
        page,
        url,
        profile,
        dryRun,
        weekKey,
        screenshotDirectory: OUTPUT_DIRECTORY,
        solve: (theme, questions) => solveQuiz({ theme, questions, generateJson }),
      }).catch(async (error: unknown) => {
        await page
          .screenshot({ path: `${OUTPUT_DIRECTORY}/failure.png`, fullPage: true })
          .catch(() => undefined);
        throw error;
      });
      await writeJson(`${OUTPUT_DIRECTORY}/result.json`, result);
      await writeJson(`${OUTPUT_DIRECTORY}/state.json`, result.record);
      await recordStatus(result.record.status, weekKey);

      await writeNotification(buildCompletionNotification(result.record, weekKey));
    } finally {
      await browser.close();
    }
  } catch (error) {
    const message = errorMessage(error);
    if (error instanceof ScoreExtractionError) {
      await writeJson(`${OUTPUT_DIRECTORY}/result.json`, error.result);
      await writeJson(`${OUTPUT_DIRECTORY}/state.json`, error.result.record);
      await writeJson(`${OUTPUT_DIRECTORY}/failure.json`, {
        status: "success",
        code: "score-unavailable",
        message,
      });
      await writeNotification(
        `⚠️ Quiz DSC enviado e confirmado. Tema: ${sanitizeForTelegram(error.result.record.theme, 220)}. Perguntas: ${error.result.record.questionCount}. Pontuação: não foi possível ler. Horário: ${formatSaoPauloTime(error.result.record.submittedAt)}. Semana: ${weekKey}. O envio semanal foi bloqueado para evitar duplicata.`,
      );
      await recordStatus("success", weekKey);
      return;
    }
    if (error instanceof SubmissionUnknownError) {
      const record: SubmissionRecord = {
        version: 1,
        status: "unknown",
        weekKey,
        urlHash: url ? sha256(url) : "unavailable",
        theme: "não disponível",
        submittedAt: new Date().toISOString(),
        questionCount: 0,
      };
      await writeJson(`${OUTPUT_DIRECTORY}/state.json`, record);
      await writeJson(`${OUTPUT_DIRECTORY}/failure.json`, { status: "unknown", message });
      await writeNotification(
        `⚠️ Quiz DSC com resultado incerto na semana ${weekKey}. O envio foi acionado, mas a confirmação não apareceu. Novas submissões automáticas foram bloqueadas.`,
      );
      await recordStatus("unknown", weekKey);
      return;
    }

    await writeJson(`${OUTPUT_DIRECTORY}/failure.json`, { status: "failure", message });
    await writeNotification(
      `❌ Falha no Quiz DSC da semana ${weekKey}: ${sanitizeForTelegram(message)} Nenhum envio foi confirmado.`,
    );
    await recordStatus("failure", weekKey);
  }
}

async function writeNotification(message: string): Promise<void> {
  await writeFile(`${OUTPUT_DIRECTORY}/notification.txt`, `${message}\n`, "utf8");
}

await main();
