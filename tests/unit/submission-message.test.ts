import assert from "node:assert/strict";
import { test } from "node:test";

import { buildCompletionNotification } from "../../src/submission-message.js";
import type { SubmissionRecord } from "../../src/types.js";

test("inclui a pontuação na notificação de envio bem-sucedido", () => {
  const record: SubmissionRecord = {
    version: 1,
    status: "success",
    weekKey: "2026-W33",
    urlHash: "hash",
    theme: "Tema 38 - TARIFA SOCIAL",
    submittedAt: "2026-08-12T12:00:00.000Z",
    questionCount: 3,
    confirmationText: "Sua resposta foi registrada.",
    score: { earned: 10, total: 10, label: "10/10" },
  };

  const message = buildCompletionNotification(record, record.weekKey);

  assert.match(message, /Pontuação: 10\/10\./u);
  assert.match(message, /Horário: 12\/08\/2026, 09:00\./u);
  assert.match(message, /Perguntas: 3\./u);
});
