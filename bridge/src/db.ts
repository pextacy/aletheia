import pg from "pg";
import { env } from "./env.js";

export interface SubmissionRow {
  id: number;
  chain_id: number;
  project_id: number;
  delivery_id: string;
  commit_hash: string;
  tree_hash: string;
  tx_hash: string | null;
  status: "pending" | "submitted" | "failed";
  error: string | null;
  forced: number;
  created_at: string;
}

// Neon Postgres. The connection string carries sslmode=require; a small pool is
// plenty — writes are serialized behind the tx queues and reads are sparse.
const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 5 });

// Every table is chain-scoped: one bridge process serves multiple chains from
// one database, and nothing (delivery receipts, submissions, secrets, caches)
// may leak across chains. Rows that predate multi-chain default to 10143, the
// chain the bridge served when they were written.
const LEGACY_CHAIN_ID = 10143;

let schemaReady: Promise<void> | null = null;

/** Replace the table's primary key when its column set differs from `cols`. */
async function ensurePrimaryKey(table: string, cols: string[]): Promise<void> {
  const res = await pool.query(
    `SELECT a.attname
     FROM pg_index i
     JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
     WHERE i.indrelid = $1::regclass AND i.indisprimary
     ORDER BY array_position(i.indkey, a.attnum)`,
    [table]
  );
  const current = res.rows.map((r) => r.attname as string);
  if (current.join(",") === cols.join(",")) return;
  await pool.query(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${table}_pkey`);
  await pool.query(`ALTER TABLE ${table} ADD PRIMARY KEY (${cols.join(", ")})`);
}

/**
 * Create the tables if they don't exist and migrate pre-multi-chain rows to
 * chain-scoped shape. Idempotent and memoized per process; every query path
 * awaits it first, and startup awaits it to fail fast when the database is
 * unreachable. A failed attempt clears the memo so the next call retries
 * instead of caching the error forever.
 */
export function ensureDb(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS deliveries (
          delivery_id TEXT NOT NULL,
          chain_id    INTEGER NOT NULL DEFAULT ${LEGACY_CHAIN_ID},
          repo        TEXT NOT NULL,
          received_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`);
      await pool.query(
        `ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS chain_id INTEGER NOT NULL DEFAULT ${LEGACY_CHAIN_ID}`
      );
      await ensurePrimaryKey("deliveries", ["delivery_id", "chain_id"]);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS submissions (
          id          SERIAL PRIMARY KEY,
          chain_id    INTEGER NOT NULL DEFAULT ${LEGACY_CHAIN_ID},
          project_id  INTEGER NOT NULL,
          delivery_id TEXT NOT NULL,
          commit_hash TEXT NOT NULL,
          tree_hash   TEXT NOT NULL,
          tx_hash     TEXT,
          status      TEXT NOT NULL DEFAULT 'pending',
          error       TEXT,
          forced      INTEGER NOT NULL DEFAULT 0,
          created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        )`);
      await pool.query(
        `ALTER TABLE submissions ADD COLUMN IF NOT EXISTS chain_id INTEGER NOT NULL DEFAULT ${LEGACY_CHAIN_ID}`
      );
      await pool.query(
        "CREATE INDEX IF NOT EXISTS idx_submissions_chain_project ON submissions (chain_id, project_id, id DESC)"
      );

      await pool.query(`
        CREATE TABLE IF NOT EXISTS webhook_secrets (
          chain_id   INTEGER NOT NULL DEFAULT ${LEGACY_CHAIN_ID},
          project_id INTEGER NOT NULL,
          secret     TEXT NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`);
      await pool.query(
        `ALTER TABLE webhook_secrets ADD COLUMN IF NOT EXISTS chain_id INTEGER NOT NULL DEFAULT ${LEGACY_CHAIN_ID}`
      );
      await ensurePrimaryKey("webhook_secrets", ["chain_id", "project_id"]);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS verifications (
          chain_id          INTEGER NOT NULL DEFAULT ${LEGACY_CHAIN_ID},
          project_id        INTEGER NOT NULL,
          attestation_count INTEGER NOT NULL,
          report            TEXT NOT NULL,
          verified_at       BIGINT NOT NULL,
          last_block        BIGINT NOT NULL DEFAULT 0
        )`);
      await pool.query(
        `ALTER TABLE verifications ADD COLUMN IF NOT EXISTS chain_id INTEGER NOT NULL DEFAULT ${LEGACY_CHAIN_ID}`
      );
      await pool.query(
        "ALTER TABLE verifications ADD COLUMN IF NOT EXISTS last_block BIGINT NOT NULL DEFAULT 0"
      );
      await ensurePrimaryKey("verifications", ["chain_id", "project_id"]);
    })().catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}

/** Drain and close the pool — called on graceful shutdown. */
export async function closeDb(): Promise<void> {
  await pool.end();
}

/** Returns false if this delivery ID was already processed for this chain (replay). */
export async function recordDelivery(
  deliveryId: string,
  chainId: number,
  repo: string
): Promise<boolean> {
  await ensureDb();
  const res = await pool.query(
    "INSERT INTO deliveries (delivery_id, chain_id, repo) VALUES ($1, $2, $3) ON CONFLICT (delivery_id, chain_id) DO NOTHING",
    [deliveryId, chainId, repo]
  );
  return (res.rowCount ?? 0) > 0;
}

/**
 * Release a delivery ID for one chain so a later redelivery reprocesses it.
 * Called only after a definitive submission failure: the delivery was recorded
 * on receipt (to dedupe concurrent redeliveries), but if the attestation never
 * landed, keeping the record would make GitHub's retry look like a duplicate
 * and silently drop the commits. The failed submission rows remain for the
 * /status audit trail.
 */
export async function releaseDelivery(deliveryId: string, chainId: number): Promise<void> {
  await ensureDb();
  await pool.query("DELETE FROM deliveries WHERE delivery_id = $1 AND chain_id = $2", [
    deliveryId,
    chainId,
  ]);
}

export async function recordSubmission(
  chainId: number,
  projectId: bigint,
  deliveryId: string,
  commitHash: string,
  treeHash: string,
  forced: boolean
): Promise<number> {
  await ensureDb();
  const res = await pool.query(
    "INSERT INTO submissions (chain_id, project_id, delivery_id, commit_hash, tree_hash, forced) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id",
    [chainId, Number(projectId), deliveryId, commitHash, treeHash, forced ? 1 : 0]
  );
  return Number(res.rows[0].id);
}

export async function markSubmissionsSubmitted(ids: number[], txHash: string): Promise<void> {
  await ensureDb();
  await pool.query("UPDATE submissions SET status='submitted', tx_hash=$1 WHERE id = ANY($2::int[])", [
    txHash,
    ids,
  ]);
}

export async function markSubmissionsFailed(ids: number[], error: string): Promise<void> {
  await ensureDb();
  await pool.query("UPDATE submissions SET status='failed', error=$1 WHERE id = ANY($2::int[])", [
    error,
    ids,
  ]);
}

export async function recentSubmissions(chainId: number, projectId: number): Promise<SubmissionRow[]> {
  await ensureDb();
  const res = await pool.query(
    `SELECT id, chain_id, project_id, delivery_id, commit_hash, tree_hash, tx_hash, status, error, forced,
            created_at::text AS created_at
     FROM submissions WHERE chain_id = $1 AND project_id = $2 ORDER BY id DESC LIMIT 50`,
    [chainId, projectId]
  );
  return res.rows as SubmissionRow[];
}

export async function setWebhookSecret(
  chainId: number,
  projectId: number,
  secret: string
): Promise<void> {
  await ensureDb();
  await pool.query(
    `INSERT INTO webhook_secrets (chain_id, project_id, secret) VALUES ($1, $2, $3)
     ON CONFLICT (chain_id, project_id) DO UPDATE SET secret = EXCLUDED.secret, updated_at = now()`,
    [chainId, projectId, secret]
  );
}

export async function getWebhookSecret(chainId: number, projectId: number): Promise<string | null> {
  await ensureDb();
  const res = await pool.query(
    "SELECT secret FROM webhook_secrets WHERE chain_id = $1 AND project_id = $2",
    [chainId, projectId]
  );
  return res.rows.length > 0 ? (res.rows[0].secret as string) : null;
}

export interface CachedVerification {
  attestationCount: number;
  report: string;
  verifiedAt: number;
  lastBlock: number;
}

export async function saveVerification(
  chainId: number,
  projectId: number,
  attestationCount: number,
  report: string,
  verifiedAt: number,
  lastBlock: number
): Promise<void> {
  await ensureDb();
  await pool.query(
    `INSERT INTO verifications (chain_id, project_id, attestation_count, report, verified_at, last_block)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (chain_id, project_id) DO UPDATE SET
       attestation_count = EXCLUDED.attestation_count,
       report = EXCLUDED.report,
       verified_at = EXCLUDED.verified_at,
       last_block = EXCLUDED.last_block`,
    [chainId, projectId, attestationCount, report, verifiedAt, lastBlock]
  );
}

/** Advance the staleness-probe floor after a no-new-attestations check. */
export async function touchVerificationScan(
  chainId: number,
  projectId: number,
  lastBlock: number
): Promise<void> {
  await ensureDb();
  await pool.query(
    "UPDATE verifications SET last_block = $1 WHERE chain_id = $2 AND project_id = $3",
    [lastBlock, chainId, projectId]
  );
}

export async function getVerification(
  chainId: number,
  projectId: number
): Promise<CachedVerification | null> {
  await ensureDb();
  const res = await pool.query(
    "SELECT attestation_count, report, verified_at, last_block FROM verifications WHERE chain_id = $1 AND project_id = $2",
    [chainId, projectId]
  );
  if (res.rows.length === 0) return null;
  const row = res.rows[0] as {
    attestation_count: number;
    report: string;
    verified_at: string;
    last_block: string;
  };
  return {
    attestationCount: Number(row.attestation_count),
    report: row.report,
    verifiedAt: Number(row.verified_at),
    lastBlock: Number(row.last_block),
  };
}
