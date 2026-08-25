import { readFile } from "node:fs/promises";

import "dotenv/config";

import { requireEnv, sanitizeForTelegram } from "../runtime.js";
import { TelegramClient } from "../telegram.js";

async function main(): Promise<void> {
  const messagePath = process.env.TELEGRAM_MESSAGE_FILE?.trim();
  const rawMessage = messagePath
    ? await readFile(messagePath, "utf8")
    : requireEnv("TELEGRAM_MESSAGE");
  const message = sanitizeForTelegram(rawMessage, 3_500);
  await new TelegramClient(requireEnv("TELEGRAM_BOT_TOKEN")).sendMessage(
    requireEnv("TELEGRAM_USER_ID"),
    message,
  );
}

await main();
