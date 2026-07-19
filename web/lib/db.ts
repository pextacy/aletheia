import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

// Neon serverless Postgres, used as a read-index of on-chain registry events so
// pages don't re-scan the whole chain over RPC on every request. Entirely
// optional: with DATABASE_URL unset, `sql` is null and every read falls back to
// the RPC path, so the app runs unchanged until Neon is wired up.

const url = process.env.DATABASE_URL ?? "";

/** True when a usable Postgres connection string is configured. */
export const dbEnabled = /^postgres(ql)?:\/\//i.test(url);

export const sql: NeonQueryFunction<false, false> | null = dbEnabled ? neon(url) : null;

let schemaReady: Promise<void> | null = null;

// Rows written before multi-chain support belong to the chain the site served
// then — Monad testnet.
const LEGACY_CHAIN_ID = 10143;

/** Replace the table's primary key when its column set differs from `cols`. */
async function ensurePrimaryKey(
  q: NonNullable<typeof sql>,
  table: string,
  cols: string[]
): Promise<void> {
  const rows = (await q.query(
    `select a.attname
     from pg_index i
     join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any (i.indkey)
     where i.indrelid = $1::regclass and i.indisprimary
     order by array_position(i.indkey, a.attnum)`,
    [table]
  )) as Array<{ attname: string }>;
  const current = rows.map((r) => r.attname);
  if (current.join(",") === cols.join(",")) return;
  await q.query(`alter table ${table} drop constraint if exists ${table}_pkey`, []);
  await q.query(`alter table ${table} add primary key (${cols.join(", ")})`, []);
}

/**
 * Create the index tables if they don't exist and migrate pre-multi-chain rows
 * to chain-scoped shape (chain_id backfilled to the testnet). Idempotent and
 * memoized per process, so callers can await it cheaply before any query.
 */
export function ensureSchema(): Promise<void> {
  if (!sql) return Promise.resolve();
  if (!schemaReady) {
    const q = sql;
    schemaReady = (async () => {
      // DDL runs via q.query: tagged templates parameterize interpolations and
      // Postgres DDL cannot take bind parameters.
      await q.query(
        `create table if not exists projects (
          chain_id    integer not null default ${LEGACY_CHAIN_ID},
          project_id  integer not null,
          owner       text   not null,
          attestor    text   not null,
          repo_hash   text   not null,
          repo_url    text   not null,
          created_at  bigint not null,
          sealed_at   bigint,
          seal_tx     text,
          reg_tx      text,
          reg_block   bigint
        )`,
        []
      );
      await q.query(
        `alter table projects add column if not exists chain_id integer not null default ${LEGACY_CHAIN_ID}`,
        []
      );
      await ensurePrimaryKey(q, "projects", ["chain_id", "project_id"]);
      // repo uniqueness is per chain now — the same repo may register on both
      await q`alter table projects drop constraint if exists projects_repo_hash_key`;
      await q`create unique index if not exists projects_chain_repo_idx on projects (chain_id, repo_hash)`;
      await q.query(
        `create table if not exists attestations (
          chain_id     integer not null default ${LEGACY_CHAIN_ID},
          project_id   integer not null,
          commit_hash  text    not null,
          tree_hash    text    not null,
          timestamp    bigint  not null,
          tx_hash      text    not null,
          block_number bigint  not null
        )`,
        []
      );
      await q.query(
        `alter table attestations add column if not exists chain_id integer not null default ${LEGACY_CHAIN_ID}`,
        []
      );
      await ensurePrimaryKey(q, "attestations", ["chain_id", "tx_hash", "commit_hash"]);
      await q.query(
        `create table if not exists contract_links (
          chain_id     integer not null default ${LEGACY_CHAIN_ID},
          project_id   integer not null,
          address      text    not null,
          label        text    not null,
          timestamp    bigint  not null,
          tx_hash      text    not null,
          block_number bigint  not null
        )`,
        []
      );
      await q.query(
        `alter table contract_links add column if not exists chain_id integer not null default ${LEGACY_CHAIN_ID}`,
        []
      );
      await ensurePrimaryKey(q, "contract_links", ["chain_id", "tx_hash", "address"]);
      await q`
        create table if not exists sync_state (
          id         integer not null,
          last_block bigint  not null
        )
      `;
      // sync_state's id is now the chain id; the legacy singleton row (id=1)
      // recorded the testnet cursor, so re-key it.
      await q.query(
        `alter table sync_state add column if not exists id integer not null default ${LEGACY_CHAIN_ID}`,
        []
      );
      await q`update sync_state set id = ${LEGACY_CHAIN_ID} where id = 1`;
      await ensurePrimaryKey(q, "sync_state", ["id"]);
      await q`create index if not exists attestations_chain_project_idx on attestations (chain_id, project_id)`;
      await q`create index if not exists attestations_chain_ts_idx on attestations (chain_id, timestamp desc)`;
      await q`create index if not exists links_chain_project_idx on contract_links (chain_id, project_id)`;
    })().catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}
