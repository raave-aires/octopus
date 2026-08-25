import { mkdir } from "node:fs/promises";

import "dotenv/config";

import { errorMessage, requireEnv, setGitHubOutput, writeJson } from "../runtime.js";
import { collectLatestFormLink, TelegramClient } from "../telegram.js";

const STATE_DIRECTORY = ".state/telegram";

async function main(): Promise<void> {
  await mkdir(STATE_DIRECTORY, { recursive: true });
  const token = requireEnv("TELEGRAM_BOT_TOKEN");
  const allowedUserId = requireEnv("TELEGRAM_USER_ID");
  const client = new TelegramClient(token);
  const updates = await client.getUpdates();
  const result = await collectLatestFormLink({ updates, allowedUserId });

  await writeJson(`${STATE_DIRECTORY}/collection-result.json`, result);
  await setGitHubOutput("has_updates", result.maxUpdateId !== undefined);
  await setGitHubOutput("has_link", result.storedLink !== undefined);

  if (result.storedLink) {
    await writeJson(`${STATE_DIRECTORY}/form-link.json`, result.storedLink);
    const timestamp = result.storedLink.receivedAt.replace(/\D/gu, "").slice(0, 14);
    await setGitHubOutput(
      "artifact_name",
      `dsc-link-${timestamp}-${result.storedLink.telegramUpdateId}`,
    );
    console.log("Um link válido do Google Forms foi preparado para persistência.");
  } else {
    console.log("Nenhum link novo e válido foi encontrado nas atualizações pendentes.");
  }
}

main().catch((error: unknown) => {
  console.error(`Falha ao coletar link: ${errorMessage(error)}`);
  process.exitCode = 1;
});
