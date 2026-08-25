import assert from "node:assert/strict";
import { test } from "node:test";

import { solveQuiz, validateQuizDecisions } from "../../src/gemini.js";
import type { QuizQuestion } from "../../src/types.js";

const questions: QuizQuestion[] = [
  { id: "q1", prompt: "Tarifa ainda pode ter cobranças?", options: ["Não", "Sim"] },
  { id: "q2", prompt: "105 - 80", options: ["0", "25", "105"] },
  { id: "q3", prompt: "Como orientar?", options: ["Negar", "Verificar cadastro"] },
];

const valid = {
  answers: [
    { questionId: "q1", optionIndex: 1, rationale: "Pode haver outras cobranças." },
    { questionId: "q2", optionIndex: 1, rationale: "A diferença é 25." },
    { questionId: "q3", optionIndex: 1, rationale: "É preciso verificar." },
  ],
};

test("valida a resposta B, B, B do fixture lógico", () => {
  assert.deepEqual(validateQuizDecisions(valid, questions).map((item) => item.optionIndex), [1, 1, 1]);
});

test("rejeita pergunta duplicada e índice fora da faixa", () => {
  assert.throws(
    () => validateQuizDecisions({ answers: [valid.answers[0], valid.answers[0], valid.answers[2]] }, questions),
    /mais de uma vez/u,
  );
  assert.throws(
    () => validateQuizDecisions({ answers: [{ ...valid.answers[0], optionIndex: 9 }, ...valid.answers.slice(1)] }, questions),
    /Índice/u,
  );
});

test("repete uma vez quando o Gemini retorna JSON estruturalmente inválido", async () => {
  let calls = 0;
  const decisions = await solveQuiz({
    theme: "Tema",
    questions,
    generateJson: async () => {
      calls += 1;
      return calls === 1 ? '{"answers":[]}' : JSON.stringify(valid);
    },
  });
  assert.equal(calls, 2);
  assert.equal(decisions.length, 3);
});
