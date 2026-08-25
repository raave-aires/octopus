import "dotenv/config";

import { listActiveArtifacts, newestArtifact } from "../github-artifacts.js";
import { getIsoWeekKey, parseBoolean, requireEnv, setGitHubOutput } from "../runtime.js";

async function main(): Promise<void> {
  const weekKey = getIsoWeekKey();
  const dryRun = parseBoolean(process.env.DRY_RUN);
  const ignoreDuplicate = parseBoolean(process.env.IGNORE_DUPLICATE);
  const override = process.env.FORM_URL_OVERRIDE?.trim();
  const artifacts = await listActiveArtifacts({
    repository: requireEnv("GITHUB_REPOSITORY"),
    token: requireEnv("GITHUB_TOKEN"),
  });

  const success = newestArtifact(artifacts, (artifact) => artifact.name === `dsc-success-${weekKey}`);
  const unknown = newestArtifact(artifacts, (artifact) => artifact.name === `dsc-unknown-${weekKey}`);
  const blockedBy = success ? "success" : unknown ? "unknown" : undefined;
  const blocked = !dryRun && !ignoreDuplicate && blockedBy !== undefined;

  if (ignoreDuplicate && blockedBy !== undefined) {
    console.log(
      `Marcador ${blockedBy} da semana ${weekKey} ignorado a pedido: o formulário receberá uma resposta adicional.`,
    );
  }

  await setGitHubOutput("week_key", weekKey);
  await setGitHubOutput("blocked", blocked);
  await setGitHubOutput("blocked_by", blockedBy ?? "");

  if (blocked) {
    await setGitHubOutput("source", "blocked");
    console.log(`A semana ${weekKey} já possui marcador ${blockedBy}.`);
    return;
  }

  if (override) {
    await setGitHubOutput("source", "override");
    console.log("Será usado o URL informado manualmente.");
    return;
  }

  const linkArtifact = newestArtifact(artifacts, (artifact) => artifact.name.startsWith("dsc-link-"));
  if (!linkArtifact?.workflow_run?.id) {
    await setGitHubOutput("source", "missing");
    console.log("Nenhum artefato de link válido foi encontrado.");
    return;
  }

  await setGitHubOutput("source", "artifact");
  await setGitHubOutput("artifact_id", linkArtifact.id);
  await setGitHubOutput("artifact_name", linkArtifact.name);
  await setGitHubOutput("run_id", linkArtifact.workflow_run.id);
  console.log("O link persistido mais recente foi localizado.");
}

await main();
