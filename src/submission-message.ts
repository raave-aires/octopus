import { sanitizeForTelegram } from "./runtime.js";
import type { SubmissionRecord } from "./types.js";

export function formatSaoPauloTime(value: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

export function buildCompletionNotification(
  record: SubmissionRecord,
  weekKey: string,
): string {
  const successful = record.status === "success";
  const prefix = successful ? "✅" : "🧪";
  const action = successful ? "enviado" : "preenchido em dry-run";
  const score = record.score ? ` Pontuação: ${record.score.label}.` : "";
  return `${prefix} Quiz DSC ${action}. Tema: ${sanitizeForTelegram(record.theme, 220)}. Perguntas: ${record.questionCount}.${score} Horário: ${formatSaoPauloTime(record.submittedAt)}. Semana: ${weekKey}.`;
}
