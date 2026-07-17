import Database from "better-sqlite3";
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

const db = new Database(env.DB_PATH);
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS deliveries (
    delivery_id TEXT PRIMARY KEY,
    repo        TEXT NOT NULL,
    received_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS submissions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id  INTEGER NOT NULL,
    delivery_id TEXT NOT NULL,
    commit_hash TEXT NOT NULL,
    tree_hash   TEXT NOT NULL,
    tx_hash     TEXT,
    status      TEXT NOT NULL DEFAULT 'pending',
    error       TEXT,
    forced      INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_submissions_project ON submissions(project_id, id DESC);
  CREATE TABLE IF NOT EXISTS webhook_secrets (
    project_id INTEGER PRIMARY KEY,
    secret     TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS verifications (
    project_id        INTEGER PRIMARY KEY,
    attestation_count INTEGER NOT NULL,
    report            TEXT NOT NULL,
    verified_at       INTEGER NOT NULL
  );
`);

const insertDelivery = db.prepare("INSERT INTO deliveries (delivery_id, repo) VALUES (?, ?)");
const insertSubmission = db.prepare(
  "INSERT INTO submissions (project_id, delivery_id, commit_hash, tree_hash, forced) VALUES (?, ?, ?, ?, ?)"
);
const markSubmitted = db.prepare("UPDATE submissions SET status='submitted', tx_hash=? WHERE id=?");
const markFailed = db.prepare("UPDATE submissions SET status='failed', error=? WHERE id=?");
const recentByProject = db.prepare(
  "SELECT * FROM submissions WHERE project_id=? ORDER BY id DESC LIMIT 50"
);

const deleteDeliveryStmt = db.prepare("DELETE FROM deliveries WHERE delivery_id = ?");

/** Returns false if this delivery ID was already processed (replay). */
export function recordDelivery(deliveryId: string, repo: string): boolean {
  try {
    insertDelivery.run(deliveryId, repo);
    return true;
  } catch (err) {
    if (err instanceof Error && err.message.includes("UNIQUE constraint failed")) return false;
    throw err;
  }
}

/**
 * Release a delivery ID so a later redelivery reprocesses it. Called only after
 * a definitive submission failure: the delivery was recorded on receipt (to
 * dedupe concurrent redeliveries), but if the attestation never landed, keeping
 * the record would make GitHub's retry look like a duplicate and silently drop
 * the commits. The failed submission rows remain for the /status audit trail.
 */
export function releaseDelivery(deliveryId: string): void {
  deleteDeliveryStmt.run(deliveryId);
}

export function recordSubmission(
  projectId: bigint,
  deliveryId: string,
  commitHash: string,
  treeHash: string,
  forced: boolean
): number {
  const res = insertSubmission.run(Number(projectId), deliveryId, commitHash, treeHash, forced ? 1 : 0);
  return Number(res.lastInsertRowid);
}

export function markSubmissionsSubmitted(ids: number[], txHash: string): void {
  for (const id of ids) markSubmitted.run(txHash, id);
}

export function markSubmissionsFailed(ids: number[], error: string): void {
  for (const id of ids) markFailed.run(error, id);
}

export function recentSubmissions(projectId: number): SubmissionRow[] {
  return recentByProject.all(projectId) as SubmissionRow[];
}

const upsertSecret = db.prepare(
  "INSERT INTO webhook_secrets (project_id, secret) VALUES (?, ?) ON CONFLICT(project_id) DO UPDATE SET secret=excluded.secret, updated_at=datetime('now')"
);
const selectSecret = db.prepare("SELECT secret FROM webhook_secrets WHERE project_id=?");

export function setWebhookSecret(projectId: number, secret: string): void {
  upsertSecret.run(projectId, secret);
}

export function getWebhookSecret(projectId: number): string | null {
  const row = selectSecret.get(projectId) as { secret: string } | undefined;
  return row?.secret ?? null;
}

const upsertVerification = db.prepare(
  "INSERT INTO verifications (project_id, attestation_count, report, verified_at) VALUES (?, ?, ?, ?) ON CONFLICT(project_id) DO UPDATE SET attestation_count=excluded.attestation_count, report=excluded.report, verified_at=excluded.verified_at"
);
const selectVerification = db.prepare("SELECT * FROM verifications WHERE project_id=?");

export interface CachedVerification {
  attestationCount: number;
  report: string;
  verifiedAt: number;
}

export function saveVerification(
  projectId: number,
  attestationCount: number,
  report: string,
  verifiedAt: number
): void {
  upsertVerification.run(projectId, attestationCount, report, verifiedAt);
}

export function getVerification(projectId: number): CachedVerification | null {
  const row = selectVerification.get(projectId) as
    | { attestation_count: number; report: string; verified_at: number }
    | undefined;
  return row
    ? { attestationCount: row.attestation_count, report: row.report, verifiedAt: row.verified_at }
    : null;
}
