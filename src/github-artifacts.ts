import { ExternalServiceError } from "./errors.js";
import type { GitHubArtifact } from "./types.js";
import type { FetchLike } from "./telegram.js";

interface ArtifactListResponse {
  total_count: number;
  artifacts: GitHubArtifact[];
}

export function parseRepository(value: string): { owner: string; repo: string } {
  const [owner, repo, extra] = value.split("/");
  if (!owner || !repo || extra) {
    throw new Error("GITHUB_REPOSITORY deve estar no formato owner/repo.");
  }
  return { owner, repo };
}

export async function listActiveArtifacts(options: {
  repository: string;
  token: string;
  fetchImpl?: FetchLike;
}): Promise<GitHubArtifact[]> {
  const { owner, repo } = parseRepository(options.repository);
  const fetchImpl = options.fetchImpl ?? fetch;
  const artifacts: GitHubArtifact[] = [];

  for (let page = 1; page <= 10; page += 1) {
    const url = new URL(`https://api.github.com/repos/${owner}/${repo}/actions/artifacts`);
    url.searchParams.set("per_page", "100");
    url.searchParams.set("page", String(page));
    const response = await fetchImpl(url, {
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${options.token}`,
        "x-github-api-version": "2022-11-28",
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      throw new ExternalServiceError(`GitHub Artifacts respondeu HTTP ${response.status}.`);
    }
    const payload = (await response.json()) as ArtifactListResponse;
    artifacts.push(...payload.artifacts.filter((artifact) => !artifact.expired));
    if (page * 100 >= payload.total_count) break;
  }

  return artifacts;
}

export function newestArtifact(
  artifacts: GitHubArtifact[],
  predicate: (artifact: GitHubArtifact) => boolean,
): GitHubArtifact | undefined {
  return artifacts
    .filter(predicate)
    .sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at))[0];
}
