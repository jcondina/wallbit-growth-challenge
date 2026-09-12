import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * X-Wallbit-Signature: "sha256=<hex>" — HMAC-SHA256 of the raw request body.
 * Verified over the exact bytes received (never a re-serialized JSON), with a
 * constant-time comparison. Length is checked first because timingSafeEqual
 * throws on mismatched lengths, and a throw here would become a 500 the
 * provider retries forever.
 */

export const SIGNATURE_PREFIX = "sha256=";

export function signBody(secret: string, rawBody: Buffer): string {
  return SIGNATURE_PREFIX + createHmac("sha256", secret).update(rawBody).digest("hex");
}

export type SignatureCheck = "ok" | "missing" | "malformed" | "mismatch";

export function verifySignature(secret: string, rawBody: Buffer, header: string | null | undefined): SignatureCheck {
  if (header === null || header === undefined || header === "") return "missing";
  if (!header.startsWith(SIGNATURE_PREFIX)) return "malformed";
  const given = header.slice(SIGNATURE_PREFIX.length);
  if (!/^[0-9a-f]{64}$/i.test(given)) return "malformed";

  const expected = createHmac("sha256", secret).update(rawBody).digest();
  const provided = Buffer.from(given, "hex");
  if (provided.length !== expected.length) return "mismatch";
  return timingSafeEqual(provided, expected) ? "ok" : "mismatch";
}
