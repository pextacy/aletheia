import pg from "pg";
import { env } from "./env.js";

export interface SubmissionRow {
  id: number;
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
// plenty — writes are serialized behind the tx queue and reads are sparse.
const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 5 });

let schemaReady: Promise<void> | null = null;

/**
 * Create the tables if they don't exist. Idempotent and memoized per process;
 * every query path awaits it first, and startup awaits it to fail fast when the
 * database is unreachable. A failed attempt clears the memo so the next call
 * retries instead of caching the error forever.
 */
export function ensureDb(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS deliveries (
          delivery_id TEXT PRIMARY KEY,
          repo        TEXT NOT NULL,
          received_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS submissions (
          id          SERIAL PRIMARY KEY,
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
        "CREATE INDEX IF NOT EXISTS idx_submissions_project ON submissions (project_id, id DESC)"
      );
      await pool.query(`
        CREATE TABLE IF NOT EXISTS webhook_secrets (
          project_id INTEGER PRIMARY KEY,
          secret     TEXT NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS verifications (
          project_id        INTEGER PRIMARY KEY,
          attestation_count INTEGER NOT NULL,
          report            TEXT NOT NULL,
          verified_at       BIGINT NOT NULL
        )`);
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

/** Returns false if this delivery ID was already processed (replay). */
export async function recordDelivery(deliveryId: string, repo: string): Promise<boolean> {
  await ensureDb();
  const res = await pool.query(
    "INSERT INTO deliveries (delivery_id, repo) VALUES ($1, $2) ON CONFLICT (delivery_id) DO NOTHING",
    [deliveryId, repo]
  );
  return (res.rowCount ?? 0) > 0;
}

/**
 * Release a delivery ID so a later redelivery reprocesses it. Called only after
 * a definitive submission failure: the delivery was recorded on receipt (to
 * dedupe concurrent redeliveries), but if the attestation never landed, keeping
 * the record would make GitHub's retry look like a duplicate and silently drop
 * the commits. The failed submission rows remain for the /status audit trail.
 */
export async function releaseDelivery(deliveryId: string): Promise<void> {
  await ensureDb();
  await pool.query("DELETE FROM deliveries WHERE delivery_id = $1", [deliveryId]);
}

export async function recordSubmission(
  projectId: bigint,
  deliveryId: string,
  commitHash: string,
  treeHash: string,
  forced: boolean
): Promise<number> {
  await ensureDb();
  const res = await pool.query(
    "INSERT INTO submissions (project_id, delivery_id, commit_hash, tree_hash, forced) VALUES ($1, $2, $3, $4, $5) RETURNING id",
    [Number(projectId), deliveryId, commitHash, treeHash, forced ? 1 : 0]
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

export async function recentSubmissions(projectId: number): Promise<SubmissionRow[]> {
  await ensureDb();
  const res = await pool.query(
    `SELECT id, project_id, delivery_id, commit_hash, tree_hash, tx_hash, status, error, forced,
            created_at::text AS created_at
     FROM submissions WHERE project_id = $1 ORDER BY id DESC LIMIT 50`,
    [projectId]
  );
  return res.rows as SubmissionRow[];
}

export async function setWebhookSecret(projectId: number, secret: string): Promise<void> {
  await ensureDb();
  await pool.query(
    `INSERT INTO webhook_secrets (project_id, secret) VALUES ($1, $2)
     ON CONFLICT (project_id) DO UPDATE SET secret = EXCLUDED.secret, updated_at = now()`,
    [projectId, secret]
  );
}

export async function getWebhookSecret(projectId: number): Promise<string | null> {
  await ensureDb();
  const res = await pool.query("SELECT secret FROM webhook_secrets WHERE project_id = $1", [
    projectId,
  ]);
  return res.rows.length > 0 ? (res.rows[0].secret as string) : null;
}

export interface CachedVerification {
  attestationCount: number;
  report: string;
  verifiedAt: number;
}

export async function saveVerification(
  projectId: number,
  attestationCount: number,
  report: string,
  verifiedAt: number
): Promise<void> {
  await ensureDb();
  await pool.query(
    `INSERT INTO verifications (project_id, attestation_count, report, verified_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (project_id) DO UPDATE SET
       attestation_count = EXCLUDED.attestation_count,
       report = EXCLUDED.report,
       verified_at = EXCLUDED.verified_at`,
    [projectId, attestationCount, report, verifiedAt]
  );
}

export async function getVerification(projectId: number): Promise<CachedVerification | null> {
  await ensureDb();
  const res = await pool.query(
    "SELECT attestation_count, report, verified_at FROM verifications WHERE project_id = $1",
    [projectId]
  );
  if (res.rows.length === 0) return null;
  const row = res.rows[0] as { attestation_count: number; report: string; verified_at: string };
  return {
    attestationCount: Number(row.attestation_count),
    report: row.report,
    verifiedAt: Number(row.verified_at),
  };
}
