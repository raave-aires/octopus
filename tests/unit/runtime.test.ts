import assert from "node:assert/strict";
import { test } from "node:test";

import { getIsoWeekKey, parseBoolean, sha256 } from "../../src/runtime.js";

test("calcula a semana ISO no fuso de São Paulo", () => {
  assert.equal(getIsoWeekKey(new Date("2025-12-31T15:00:00Z")), "2026-W01");
  assert.equal(getIsoWeekKey(new Date("2026-08-14T12:00:00Z")), "2026-W33");
});

test("interpreta flags booleanas de workflow", () => {
  assert.equal(parseBoolean("true"), true);
  assert.equal(parseBoolean("YES"), true);
  assert.equal(parseBoolean("false"), false);
  assert.equal(parseBoolean(undefined, true), true);
});

test("gera hash estável sem expor o URL", () => {
  assert.equal(sha256("https://example.com"), sha256("https://example.com"));
  assert.notEqual(sha256("https://example.com"), sha256("https://example.org"));
});
