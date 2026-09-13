import { formatInstant } from "@/domain/time";
import { getDb } from "@/infra/db";
import { funnelResults } from "@/services/funnelResults";

// GET /api/funnel — same read model as the /funnel page.
export async function GET() {
  const r = funnelResults(getDb());
  return Response.json({
    ...r,
    recent: r.recent.map((e) => ({ ...e, occurredAt: formatInstant(e.occurredAt), recordedAt: formatInstant(e.recordedAt) })),
  });
}
