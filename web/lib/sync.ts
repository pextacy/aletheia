import { DEPLOY_BLOCK, events, publicClient } from "./chain";
import { dbEnabled, ensureSchema, sql } from "./db";
import { getLogsBisect } from "./indexer";
import { bytes32ToOid } from "./repo";

export interface SyncResult {
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

/**
 * Incrementally index the registry into Neon: read every registry event since
 * the last synced block and upsert it. Idempotent — primary keys and
 * `on conflict do nothing` make re-runs and overlapping ranges safe, so this can
 * be called from a cron, a webhook, or manually without coordination.
 */
export async function syncRegistry(): Promise<SyncResult> {
  if (!dbEnabled || !sql) return { ok: false, reason: "DATABASE_URL not configured" };
  const db = sql;
  await ensureSchema();

  const stateRows = (await db`select last_block from sync_state where id = 1`) as {
    last_block: string | number;
  }[];
  const lastSynced = stateRows.length ? BigInt(stateRows[0]!.last_block) : DEPLOY_BLOCK - 1n;
  const from = lastSynced + 1n;
  const head = await publicClient.getBlockNumber();
  if (from > head) {
    return { ok: true, fromBlock: Number(from), toBlock: Number(head), registered: 0, attested: 0, sealed: 0, linked: 0, attestorChanges: 0 };
  }

  const [regLogs, attLogs, sealLogs, linkLogs, attrLogs] = await Promise.all([
    getLogsBisect(events.registered, undefined, from, head),
    getLogsBisect(events.attested, undefined, from, head),
    getLogsBisect(events.sealed, undefined, from, head),
    getLogsBisect(events.linked, undefined, from, head),
    getLogsBisect(events.attestorChanged, undefined, from, head),
  ]);

  for (const l of regLogs) {
    await db`
      insert into projects (project_id, owner, attestor, repo_hash, repo_url, created_at, reg_tx, reg_block)
      values (
        ${Number(l.args.projectId as bigint)},
        ${(l.args.owner as string).toLowerCase()},
        ${(l.args.attestor as string).toLowerCase()},
        ${(l.args.repoHash as string).toLowerCase()},
        ${l.args.repoUrl as string},
        ${Number(l.args.timestamp as bigint)},
        ${l.transactionHash ?? ""},
        ${Number(l.blockNumber ?? 0n)}
      )
      on conflict (project_id) do nothing
    `;
  }

  for (const l of attLogs) {
    await db`
      insert into attestations (project_id, commit_hash, tree_hash, timestamp, tx_hash, block_number)
      values (
        ${Number(l.args.projectId as bigint)},
        ${bytes32ToOid(l.args.commitHash as string)},
        ${bytes32ToOid(l.args.treeHash as string)},
        ${Number(l.args.timestamp as bigint)},
        ${l.transactionHash ?? ""},
        ${Number(l.blockNumber ?? 0n)}
      )
      on conflict (tx_hash, commit_hash) do nothing
    `;
  }

  for (const l of linkLogs) {
    await db`
      insert into contract_links (project_id, address, label, timestamp, tx_hash, block_number)
      values (
        ${Number(l.args.projectId as bigint)},
        ${(l.args.deployed as string).toLowerCase()},
        ${l.args.label as string},
        ${Number(l.args.timestamp as bigint)},
        ${l.transactionHash ?? ""},
        ${Number(l.blockNumber ?? 0n)}
      )
      on conflict (tx_hash, address) do nothing
    `;
  }

  for (const l of sealLogs) {
    await db`
      update projects
      set sealed_at = ${Number(l.args.timestamp as bigint)}, seal_tx = ${l.transactionHash ?? ""}
      where project_id = ${Number(l.args.projectId as bigint)}
    `;
  }

  for (const l of attrLogs) {
    await db`
      update projects set attestor = ${(l.args.newAttestor as string).toLowerCase()}
      where project_id = ${Number(l.args.projectId as bigint)}
    `;
  }

  await db`
    insert into sync_state (id, last_block) values (1, ${Number(head)})
    on conflict (id) do update set last_block = excluded.last_block
  `;

  return {
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
