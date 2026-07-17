import { NextResponse } from "next/server";
import { syncRegistry } from "../../../lib/sync";

// Indexer trigger: pulls new registry events into Neon. Point a cron (Vercel
// Cron, GitHub Action, or an external scheduler) at this route, or hit it
// manually after a push. Idempotent, so calling it repeatedly is safe.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** When SYNC_SECRET is set, require it as ?token= or a Bearer header. */
function authorized(req: Request): boolean {
  const secret = process.env.SYNC_SECRET;
  if (!secret) return true;
  const url = new URL(req.url);
  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const token = url.searchParams.get("token") ?? bearer;
  return token === secret;
}

async function run(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, reason: "unauthorized" }, { status: 401 });
  }
  try {
    const result = await syncRegistry();
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (err) {
    return NextResponse.json(
      { ok: false, reason: err instanceof Error ? err.message : "sync failed" },
      { status: 500 }
    );
  }
}

export function GET(req: Request) {
  return run(req);
}
export function POST(req: Request) {
  return run(req);
}
