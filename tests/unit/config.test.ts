import assert from "node:assert/strict";
import { test } from "node:test";

import { getGeminiApiKey, loadProfile } from "../../src/config.js";

const validProfile = {
  fullName: "Raave de Lima Aires",
  employeeId: "1554",
  city: "PARAGOMINAS",
  employmentType: "PARCEIRA",
  supplier: "ELINSA ELETROTÉCNICA INDUSTRIAL E NAVAL DO BRASIL LTDA",
  region: "NORDESTE",
  manager: "JANILSON SAMPAIO DE OLIVEIRA",
  workArea: "Administrativo (Escritório) – apoio, análise e suporte aos processos",
};

test("valida e normaliza o perfil", () => {
  assert.deepEqual(loadProfile(JSON.stringify(validProfile)), validProfile);
});

test("rejeita perfil incompleto", () => {
  assert.throws(() => loadProfile(JSON.stringify({ fullName: "Raave" })), /employeeId/u);
});

test("lê a chave Gemini de GOOGLE_API_KEY", () => {
  assert.equal(getGeminiApiKey({ GOOGLE_API_KEY: "chave" }), "chave");
});

test("rejeita GOOGLE_API_KEY ausente ou vazio", () => {
  assert.throws(() => getGeminiApiKey({}), /GOOGLE_API_KEY/u);
  assert.throws(() => getGeminiApiKey({ GOOGLE_API_KEY: "   " }), /GOOGLE_API_KEY/u);
});
