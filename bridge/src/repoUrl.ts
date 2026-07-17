/**
 * Reduce a registered repo URL to a safe `https://github.com/owner/repo` clone
 * URL, or null if it isn't a github.com repository. Guards the /verify clone
 * against SSRF: only github.com over HTTPS, never an arbitrary attacker-set
 * host (repoUrl is set by whoever registered the project).
 */
export function normalizeGithubHttps(repoUrl: string): string | null {
  const m = repoUrl
    .trim()
    .match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/\s]+)\/([^/\s#?]+?)(?:\.git)?\/?$/i);
  if (!m) return null;
  return `https://github.com/${m[1]}/${m[2]}`;
}
