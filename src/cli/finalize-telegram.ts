import "dotenv/config";

import { readJson, requireEnv, sanitizeForTelegram } from "../runtime.js";
import { TelegramClient } from "../telegram.js";
import type { CollectionResult } from "../types.js";

async function main(): Promise<void> {
  const result = await readJson<CollectionResult>(".state/telegram/collection-result.json");
  const client = new TelegramClient(requireEnv("TELEGRAM_BOT_TOKEN"));
  const chatId = requireEnv("TELEGRAM_USER_ID");

  if (result.maxUpdateId !== undefined) {
    await client.acknowledgeThrough(result.maxUpdateId);
  }

  if (result.storedLink) {
    await client.sendMessage(
      chatId,
      "✅ Link do Quiz DSC recebido e guardado. A próxima execução semanal usará este formulário.",
    );
  }
  for (const notification of result.notifications) {
    await client.sendMessage(chatId, `⚠️ ${sanitizeForTelegram(notification)}`);
  }
}

await main();
