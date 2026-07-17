import { createHmac, timingSafeEqual } from "node:crypto";

/** GitHub-style `sha256=<hex>` signature over the raw body. */
export function computeSignature(rawBody: Buffer, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
}

/**
 * Constant-time verification of an `X-Hub-Signature-256` header against the raw
 * body. Returns false (never throws) for a missing, malformed, or mismatched
 * signature — a malformed hex header must not crash the request path.
 */
export function verifySignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  secret: string
): boolean {
  if (!signatureHeader?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const got = Buffer.from(signatureHeader.slice("sha256=".length), "hex");
  const want = Buffer.from(expected, "hex");
  return got.length === want.length && timingSafeEqual(got, want);
}
