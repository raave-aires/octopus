import "dotenv/config";

import { requireEnv } from "../runtime.js";
import { TelegramClient } from "../telegram.js";

const updates = await new TelegramClient(requireEnv("TELEGRAM_BOT_TOKEN")).getUpdates();
const privateMessages = updates
  .flatMap((update) => (update.message ? [{ updateId: update.update_id, message: update.message }] : []))
  .filter(({ message }) => message.chat.type === "private")
  .map(({ updateId, message }) => ({
    updateId,
    userId: String(message.from?.id ?? ""),
    chatId: String(message.chat.id),
    date: new Date(message.date * 1_000).toISOString(),
  }));

if (privateMessages.length === 0) {
  console.log("Nenhuma mensagem privada pendente. Envie /start ao bot e execute novamente.");
} else {
  console.table(privateMessages);
}
