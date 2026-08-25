import assert from "node:assert/strict";
import { test } from "node:test";

import {
  collectLatestFormLink,
  extractUrls,
  isAuthorizedMessage,
  normalizeFormUrl,
  type FetchLike,
  type TelegramMessage,
} from "../../src/telegram.js";

const formUrl = "https://docs.google.com/forms/d/e/abc123/viewform?usp=sf_link";

function message(overrides: Partial<TelegramMessage> = {}): TelegramMessage {
  return {
    message_id: 1,
    date: 1_786_689_600,
    text: formUrl,
    from: { id: 123 },
    chat: { id: 123, type: "private" },
    ...overrides,
  };
}

test("autoriza somente o usuário configurado no chat privado dele", () => {
  assert.equal(isAuthorizedMessage(message(), "123"), true);
  assert.equal(isAuthorizedMessage(message(), "999"), false);
  assert.equal(isAuthorizedMessage(message({ chat: { id: 123, type: "group" } }), "123"), false);
  assert.equal(isAuthorizedMessage(message({ chat: { id: 456, type: "private" } }), "123"), false);
});

test("extrai URL de texto e entidade text_link", () => {
  assert.deepEqual(extractUrls(message()), [formUrl]);
  assert.deepEqual(
    extractUrls(message({ text: "formulário", entities: [{ type: "text_link", offset: 0, length: 10, url: formUrl }] })),
    [formUrl],
  );
});

test("aceita viewform direto e rejeita hosts externos", async () => {
  assert.equal(await normalizeFormUrl(formUrl), formUrl);
  await assert.rejects(() => normalizeFormUrl("https://example.com/forms/viewform"), /não é uma página viewform/u);
});

test("resolve forms.gle e revalida o destino", async () => {
  const fetchImpl: FetchLike = async () => {
    const response = new Response("", { status: 200 });
    Object.defineProperty(response, "url", { value: formUrl });
    return response;
  };
  assert.equal(await normalizeFormUrl("https://forms.gle/example", fetchImpl), formUrl);
});

test("coleta somente o link autorizado mais recente e preserva o maior offset", async () => {
  const result = await collectLatestFormLink({
    updates: [
      { update_id: 10, message: message({ from: { id: 999 }, chat: { id: 999, type: "private" } }) },
      { update_id: 11, message: message({ message_id: 2 }) },
      { update_id: 12, message: message({ message_id: 3, text: "sem link" }) },
    ],
    allowedUserId: "123",
  });
  assert.equal(result.maxUpdateId, 12);
  assert.equal(result.storedLink?.telegramUpdateId, 11);
  assert.equal(result.storedLink?.url, formUrl);
});
