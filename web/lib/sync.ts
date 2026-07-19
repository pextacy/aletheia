import { events } from "./chain";
import { chainConfigs, type ChainConfig } from "./chains";
import { dbEnabled, ensureSchema, sql } from "./db";
import { getLogsBisect } from "./indexer";
import { bytes32ToOid } from "./repo";

export interface ChainSyncResult {
  chainId: number;
  ok: boolean;
  reason?: string;
  fromBlock?: number;
  toBlock?: number;
  registered?: number;
  attested?: number;
  sealed?: number;
  linked?: number;
  attestorChanges?: number;
}

export interface SyncResult {
  ok: boolean;
  reason?: string;
  chains: ChainSyncResult[];
}

/**
 * Incrementally index one chain's registry events into Neon. Idempotent —
 * chain-scoped primary keys and `on conflict do nothing` make re-runs and
 * overlapping ranges safe.
 */
async function syncChain(cfg: ChainConfig): Promise<ChainSyncResult> {
  const db = sql!;
  const stateRows = (await db`select last_block from sync_state where id = ${cfg.id}`) as {
    last_block: string | number;
  }[];
  const lastSynced = stateRows.length ? BigInt(stateRows[0]!.last_block) : cfg.deployBlock - 1n;
  const from = lastSynced + 1n;
  const head = await cfg.client.getBlockNumber();
  if (from > head) {
    return { chainId: cfg.id, ok: true, fromBlock: Number(from), toBlock: Number(head), registered: 0, attested: 0, sealed: 0, linked: 0, attestorChanges: 0 };
  }

  const [regLogs, attLogs, sealLogs, linkLogs, attrLogs] = await Promise.all([
    getLogsBisect(cfg, events.registered, undefined, from, head),
    getLogsBisect(cfg, events.attested, undefined, from, head),
    getLogsBisect(cfg, events.sealed, undefined, from, head),
    getLogsBisect(cfg, events.linked, undefined, from, head),
    getLogsBisect(cfg, events.attestorChanged, undefined, from, head),
  ]);

  for (const l of regLogs) {
    await db`
      insert into projects (chain_id, project_id, owner, attestor, repo_hash, repo_url, created_at, reg_tx, reg_block)
      values (
        ${cfg.id},
        ${Number(l.args.projectId as bigint)},
        ${(l.args.owner as string).toLowerCase()},
        ${(l.args.attestor as string).toLowerCase()},
        ${(l.args.repoHash as string).toLowerCase()},
        ${l.args.repoUrl as string},
        ${Number(l.args.timestamp as bigint)},
        ${l.transactionHash ?? ""},
        ${Number(l.blockNumber ?? 0n)}
      )
      on conflict (chain_id, project_id) do nothing
    `;
  }

  for (const l of attLogs) {
    await db`
      insert into attestations (chain_id, project_id, commit_hash, tree_hash, timestamp, tx_hash, block_number)
      values (
        ${cfg.id},
        ${Number(l.args.projectId as bigint)},
        ${bytes32ToOid(l.args.commitHash as string)},
        ${bytes32ToOid(l.args.treeHash as string)},
        ${Number(l.args.timestamp as bigint)},
        ${l.transactionHash ?? ""},
        ${Number(l.blockNumber ?? 0n)}
      )
      on conflict (chain_id, tx_hash, commit_hash) do nothing
    `;
  }

  for (const l of linkLogs) {
    await db`
      insert into contract_links (chain_id, project_id, address, label, timestamp, tx_hash, block_number)
      values (
        ${cfg.id},
        ${Number(l.args.projectId as bigint)},
        ${(l.args.deployed as string).toLowerCase()},
        ${l.args.label as string},
        ${Number(l.args.timestamp as bigint)},
        ${l.transactionHash ?? ""},
        ${Number(l.blockNumber ?? 0n)}
      )
      on conflict (chain_id, tx_hash, address) do nothing
    `;
  }

  for (const l of sealLogs) {
    await db`
      update projects
      set sealed_at = ${Number(l.args.timestamp as bigint)}, seal_tx = ${l.transactionHash ?? ""}
      where chain_id = ${cfg.id} and project_id = ${Number(l.args.projectId as bigint)}
    `;
  }

  for (const l of attrLogs) {
    await db`
      update projects set attestor = ${(l.args.newAttestor as string).toLowerCase()}
      where chain_id = ${cfg.id} and project_id = ${Number(l.args.projectId as bigint)}
    `;
  }

  await db`
    insert into sync_state (id, last_block) values (${cfg.id}, ${Number(head)})
    on conflict (id) do update set last_block = excluded.last_block
  `;

  return {
    chainId: cfg.id,
    ok: true,
    fromBlock: Number(from),
    toBlock: Number(head),
    registered: regLogs.length,
    attested: attLogs.length,
    sealed: sealLogs.length,
    linked: linkLogs.length,
    attestorChanges: attrLogs.length,
  };
}

/**
 * Index every configured chain into Neon, sequentially (chains share the RPC
 * budget and the database; a failure on one chain doesn't block the others).
 */
export async function syncRegistry(): Promise<SyncResult> {
  if (!dbEnabled || !sql) return { ok: false, reason: "DATABASE_URL not configured", chains: [] };
  await ensureSchema();

  const results: ChainSyncResult[] = [];
  for (const cfg of chainConfigs) {
    try {
      results.push(await syncChain(cfg));
    } catch (err) {
      results.push({
        chainId: cfg.id,
        ok: false,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { ok: results.every((r) => r.ok), chains: results };
}
