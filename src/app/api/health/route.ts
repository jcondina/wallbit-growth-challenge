import { getDb, queryOne } from "@/infra/db";

// Liveness for scripts/replay.sh: opening the connection here also warms the
// route so the first real webhook never pays the cold-start cost.
export async function GET() {
  const ok = queryOne<{ ok: number }>(getDb(), "SELECT 1 AS ok")?.ok === 1;
  return Response.json({ ok, db: ok ? "ready" : "error" });
}
