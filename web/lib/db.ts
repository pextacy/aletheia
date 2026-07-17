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

/**
 * Create the index tables if they don't exist. Idempotent and memoized per
 * process, so callers can await it cheaply before any query.
 */
export function ensureSchema(): Promise<void> {
  if (!sql) return Promise.resolve();
  if (!schemaReady) {
    const q = sql;
    schemaReady = (async () => {
      await q`
        create table if not exists projects (
          project_id  integer primary key,
          owner       text   not null,
          attestor    text   not null,
          repo_hash   text   not null unique,
          repo_url    text   not null,
          created_at  bigint not null,
          sealed_at   bigint,
          seal_tx     text,
          reg_tx      text,
          reg_block   bigint
        )
      `;
      await q`
        create table if not exists attestations (
          project_id   integer not null,
          commit_hash  text    not null,
          tree_hash    text    not null,
          timestamp    bigint  not null,
          tx_hash      text    not null,
          block_number bigint  not null,
          primary key (tx_hash, commit_hash)
        )
      `;
      await q`
        create table if not exists contract_links (
          project_id   integer not null,
          address      text    not null,
          label        text    not null,
          timestamp    bigint  not null,
          tx_hash      text    not null,
          block_number bigint  not null,
          primary key (tx_hash, address)
        )
      `;
      await q`
        create table if not exists sync_state (
          id         integer primary key,
          last_block bigint  not null
        )
      `;
      await q`create index if not exists attestations_project_idx on attestations (project_id)`;
      await q`create index if not exists attestations_ts_idx on attestations (timestamp desc)`;
      await q`create index if not exists links_project_idx on contract_links (project_id)`;
    })();
  }
  return schemaReady;
}
