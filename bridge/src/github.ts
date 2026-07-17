import { env } from "./env.js";

export interface CommitPair {
  commit: string;
  tree: string;
}

const API = "https://api.github.com";

function headers(): Record<string, string> {
  const h: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "aletheia-bridge",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (env.GITHUB_TOKEN) h.Authorization = `Bearer ${env.GITHUB_TOKEN}`;
  return h;
}

async function get(path: string): Promise<unknown> {
  const res = await fetch(`${API}${path}`, { headers: headers() });
  if (!res.ok) {
    throw new Error(`GitHub API ${path} failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

/** Tree SHA for a single commit. */
export async function fetchTreeSha(repoFullName: string, commitSha: string): Promise<string> {
  const data = (await get(`/repos/${repoFullName}/git/commits/${commitSha}`)) as {
    tree: { sha: string };
  };
  return data.tree.sha;
}

/**
 * Full commit list for a push range via the Compare API — used when the
 * webhook payload's commit list is truncated (GitHub caps it at 20).
 */
export async function fetchCompareRange(
  repoFullName: string,
  before: string,
  head: string
): Promise<CommitPair[]> {
  const pairs: CommitPair[] = [];
  let page = 1;
  for (;;) {
    const data = (await get(
      `/repos/${repoFullName}/compare/${before}...${head}?per_page=100&page=${page}`
    )) as { commits: Array<{ sha: string; commit: { tree: { sha: string } } }> };
    for (const c of data.commits) pairs.push({ commit: c.sha, tree: c.commit.tree.sha });
    if (data.commits.length < 100) break;
    page++;
  }
  return pairs;
}
