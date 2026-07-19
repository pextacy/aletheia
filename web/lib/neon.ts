import { ensureSchema, sql } from "./db";
import { canonicalRepoPath, repoFullNameFromUrl, repoHashFromPath } from "./repo";
import { buildDaySeries } from "./time";
import type {
  ActivityItem,
  AttestationEntry,
  ContractEntry,
  ExplorerProject,
  LeaderProject,
  ProjectModel,
  RecentProject,
  RegistryStats,
  RepoLookup,
  TimelineEntry,
} from "./indexer";

// Read side of the Neon index. Each function mirrors the shape of its RPC twin
// in indexer.ts so callers can swap sources transparently. All assume the sync
// job has populated the tables; a cold/empty index simply yields empty results.

const num = (v: unknown): number => Number(v ?? 0);

export async function neonFetchRecentProjects(chainId: number, limit = 12): Promise<RecentProject[]> {
  if (!sql) return [];
  await ensureSchema();
  const rows = (await sql`
    select project_id, repo_url, owner, created_at
    from projects where chain_id = ${chainId} order by project_id desc limit ${limit}
  `) as Record<string, unknown>[];
  return rows.map((r) => ({
    projectId: num(r.project_id),
    repoUrl: String(r.repo_url ?? ""),
    owner: String(r.owner ?? ""),
    timestamp: num(r.created_at),
  }));
}

export async function neonFetchAllProjects(chainId: number): Promise<ExplorerProject[]> {
  if (!sql) return [];
  await ensureSchema();
  const rows = (await sql`
    select project_id, repo_url, owner, created_at, sealed_at
    from projects where chain_id = ${chainId} order by project_id desc
  `) as Record<string, unknown>[];
  return rows.map((r) => ({
    projectId: num(r.project_id),
    repoUrl: String(r.repo_url ?? ""),
    owner: String(r.owner ?? ""),
    timestamp: num(r.created_at),
    sealedAt: r.sealed_at == null ? null : num(r.sealed_at),
  }));
}

export async function neonLookupProjectByRepo(chainId: number, url: string): Promise<RepoLookup> {
  const path = canonicalRepoPath(url);
  if (!path) return { path: null, repoHash: null, projectId: 0 };
  const repoHash = repoHashFromPath(path);
  if (!sql) return { path, repoHash, projectId: 0 };
  await ensureSchema();
  const rows = (await sql`
    select project_id from projects where chain_id = ${chainId} and repo_hash = ${repoHash.toLowerCase()} limit 1
  `) as Record<string, unknown>[];
  return { path, repoHash, projectId: rows.length ? num(rows[0]!.project_id) : 0 };
}

export async function neonFetchProject(chainId: number, projectId: number): Promise<ProjectModel | null> {
  if (!sql) return null;
  await ensureSchema();
  const projRows = (await sql`
    select project_id, owner, attestor, repo_url, created_at, sealed_at, seal_tx
    from projects where chain_id = ${chainId} and project_id = ${projectId} limit 1
  `) as Record<string, unknown>[];
  if (!projRows.length) return null;
  const p = projRows[0]!;

  const [attRows, linkRows] = await Promise.all([
    sql`
      select commit_hash, tree_hash, timestamp, tx_hash, block_number
      from attestations where chain_id = ${chainId} and project_id = ${projectId}
    ` as Promise<Record<string, unknown>[]>,
    sql`
      select address, label, timestamp, tx_hash, block_number
      from contract_links where chain_id = ${chainId} and project_id = ${projectId}
    ` as Promise<Record<string, unknown>[]>,
  ]);

  const timeline: TimelineEntry[] = [
    ...attRows.map(
      (r): AttestationEntry => ({
        kind: "attestation",
        commitHash: String(r.commit_hash ?? ""),
        treeHash: String(r.tree_hash ?? ""),
        timestamp: num(r.timestamp),
        txHash: String(r.tx_hash ?? ""),
        blockNumber: BigInt(num(r.block_number)),
      })
    ),
    ...linkRows.map(
      (r): ContractEntry => ({
        kind: "contract",
        address: String(r.address ?? ""),
        label: String(r.label ?? ""),
        timestamp: num(r.timestamp),
        txHash: String(r.tx_hash ?? ""),
        blockNumber: BigInt(num(r.block_number)),
      })
    ),
  ].sort((a, b) => a.timestamp - b.timestamp || Number(a.blockNumber - b.blockNumber));

  const repoUrl = String(p.repo_url ?? "");
  return {
    projectId: num(p.project_id),
    owner: String(p.owner ?? ""),
    attestor: String(p.attestor ?? ""),
    repoUrl,
    repoFullName: repoFullNameFromUrl(repoUrl),
    createdAt: num(p.created_at),
    sealedAt: p.sealed_at == null ? null : num(p.sealed_at),
    sealTxHash: p.seal_tx ? String(p.seal_tx) : null,
    timeline,
    attestationCount: attRows.length,
  };
}

export async function neonRegistryStats(chainId: number): Promise<RegistryStats> {
  const empty: RegistryStats = {
    projectCount: 0,
    attestationCount: 0,
    sealedCount: 0,
    linkedContractCount: 0,
    uniqueOwners: 0,
    firstActivity: null,
    lastActivity: null,
    series: [],
    leaderboard: [],
    recent: [],
  };
  if (!sql) return empty;
  await ensureSchema();

  const [totals, attDays, regDays, board, recentRows] = await Promise.all([
    sql`
      select
        (select count(*) from projects where chain_id = ${chainId})                             as projects,
        (select count(*) from attestations where chain_id = ${chainId})                         as attestations,
        (select count(*) from projects where chain_id = ${chainId} and sealed_at is not null)   as sealed,
        (select count(*) from contract_links where chain_id = ${chainId})                       as links,
        (select count(distinct owner) from projects where chain_id = ${chainId})                as owners,
        (select min(created_at) from projects where chain_id = ${chainId})                      as first_reg,
        (select min(timestamp)  from attestations where chain_id = ${chainId})                  as first_att,
        (select max(timestamp)  from attestations where chain_id = ${chainId})                  as last_att
    ` as Promise<Record<string, unknown>[]>,
    sql`
      select to_char(to_timestamp(timestamp), 'YYYY-MM-DD') as day, count(*) as n
      from attestations where chain_id = ${chainId} group by day
    ` as Promise<Record<string, unknown>[]>,
    sql`
      select to_char(to_timestamp(created_at), 'YYYY-MM-DD') as day, count(*) as n
      from projects where chain_id = ${chainId} group by day
    ` as Promise<Record<string, unknown>[]>,
    sql`
      select a.project_id, count(*) as n, p.repo_url, (p.sealed_at is not null) as sealed
      from attestations a join projects p on p.chain_id = a.chain_id and p.project_id = a.project_id
      where a.chain_id = ${chainId}
      group by a.project_id, p.repo_url, p.sealed_at
      order by n desc, a.project_id asc
    ` as Promise<Record<string, unknown>[]>,
    sql`
      select a.project_id, a.commit_hash, a.timestamp, a.tx_hash, p.repo_url
      from attestations a join projects p on p.chain_id = a.chain_id and p.project_id = a.project_id
      where a.chain_id = ${chainId}
      order by a.timestamp desc limit 12
    ` as Promise<Record<string, unknown>[]>,
  ]);

  const t = totals[0] ?? {};
  const firstReg = t.first_reg == null ? null : num(t.first_reg);
  const firstAtt = t.first_att == null ? null : num(t.first_att);
  const lastAtt = t.last_att == null ? null : num(t.last_att);
  const firstActivity =
    firstReg === null ? firstAtt : firstAtt === null ? firstReg : Math.min(firstReg, firstAtt);
  const lastActivity = lastAtt ?? firstActivity;

  const attByDay = new Map<string, number>(attDays.map((r) => [String(r.day), num(r.n)]));
  const regByDay = new Map<string, number>(regDays.map((r) => [String(r.day), num(r.n)]));
  const series = buildDaySeries(attByDay, regByDay, firstActivity, lastActivity);

  const leaderboard: LeaderProject[] = board.map((r) => ({
    projectId: num(r.project_id),
    repoUrl: String(r.repo_url ?? ""),
    attestations: num(r.n),
    sealed: r.sealed === true || r.sealed === "t",
  }));

  const recent: ActivityItem[] = recentRows.map((r) => ({
    projectId: num(r.project_id),
    repoUrl: String(r.repo_url ?? ""),
    commitHash: String(r.commit_hash ?? ""),
    timestamp: num(r.timestamp),
    txHash: String(r.tx_hash ?? ""),
  }));

  return {
    projectCount: num(t.projects),
    attestationCount: num(t.attestations),
    sealedCount: num(t.sealed),
    linkedContractCount: num(t.links),
    uniqueOwners: num(t.owners),
    firstActivity,
    lastActivity,
    series,
    leaderboard,
    recent,
  };
}
