import assert from "node:assert/strict";
import { test } from "node:test";

import { newestArtifact, parseRepository } from "../../src/github-artifacts.js";
import type { GitHubArtifact } from "../../src/types.js";

test("valida o nome owner/repo", () => {
  assert.deepEqual(parseRepository("owner/repo"), { owner: "owner", repo: "repo" });
  assert.throws(() => parseRepository("owner"), /owner\/repo/u);
});

test("seleciona o artefato ativo mais recente pelo predicado", () => {
  const artifacts: GitHubArtifact[] = [
    { id: 1, name: "dsc-link-old", expired: false, created_at: "2026-08-10T00:00:00Z", expires_at: "2026-08-24T00:00:00Z" },
    { id: 2, name: "dsc-link-new", expired: false, created_at: "2026-08-12T00:00:00Z", expires_at: "2026-08-26T00:00:00Z" },
  ];
  assert.equal(newestArtifact(artifacts, (item) => item.name.startsWith("dsc-link"))?.id, 2);
});
