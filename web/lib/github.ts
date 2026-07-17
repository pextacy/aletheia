export interface CommitMeta {
  message: string;
  author: string;
}

/**
 * Commit metadata for display. Chain data is the record; GitHub is garnish —
 * any failure here degrades to chain-only rendering, never to an error page.
 */
export async function fetchCommitMeta(
  repoFullName: string,
  shas: string[]
): Promise<Map<string, CommitMeta>> {
  const out = new Map<string, CommitMeta>();
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "aletheia-web",
  };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

  await Promise.all(
    shas.map(async (sha) => {
      try {
        const res = await fetch(`https://api.github.com/repos/${repoFullName}/commits/${sha}`, {
          headers,
          next: { revalidate: 3600 },
        });
        if (!res.ok) return;
        const data = (await res.json()) as {
          commit?: { message?: string; author?: { name?: string } };
        };
        if (data.commit?.message) {
          out.set(sha, {
            message: data.commit.message.split("\n")[0]!,
            author: data.commit.author?.name ?? "",
          });
        }
      } catch {
        // degrade silently — the page renders fully from chain data alone
      }
    })
  );
  return out;
}
