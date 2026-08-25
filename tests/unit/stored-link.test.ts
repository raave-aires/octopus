import assert from "node:assert/strict";
import { test } from "node:test";

import { assertRecentLink } from "../../src/link-state.js";
import type { StoredFormLink } from "../../src/types.js";

function link(receivedAt: string): StoredFormLink {
  return {
    version: 1,
    url: "https://docs.google.com/forms/d/e/abc/viewform",
    senderId: "1",
    chatId: "2",
    telegramUpdateId: 3,
    receivedAt,
  };
}

test("aceita link com até oito dias e rejeita link vencido", () => {
  const now = new Date("2026-08-14T12:00:00Z");
  assert.doesNotThrow(() => assertRecentLink(link("2026-08-07T12:00:01Z"), now));
  assert.throws(() => assertRecentLink(link("2026-08-06T11:59:59Z"), now), /oito dias/u);
});
