import { getDb } from "@/infra/db";

// Liveness for scripts/replay.sh: opening the connection here also warms the
// route so the first real webhook never pays the cold-start cost.
export async function GET() {
  const db = getDb();
  const ok = db.prepare("SELECT 1 AS ok").get() as { ok: number } | undefined;
  return Response.json({ ok: ok?.ok === 1, db: ok?.ok === 1 ? "ready" : "error" });
}
