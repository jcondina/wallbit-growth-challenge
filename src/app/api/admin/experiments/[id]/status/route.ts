import { z } from "zod";
import { formatInstant, systemClock } from "@/domain/time";
import { getDb } from "@/infra/db";
import { setStatus } from "@/services/experimentControl";

const Body = z.object({ status: z.enum(["running", "paused", "finished"]) }).strict();

// POST /api/admin/experiments/[id]/status  { "status": "paused" | "running" | "finished" }
// No auth: this is the exercise's kill-switch stub (ENTREGA: "lo que está flojo").
export async function POST(request: Request, { params }: RouteContext<"/api/admin/experiments/[id]/status">) {
  const { id } = await params;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "body must be { status: running | paused | finished }" }, { status: 400 });

  const outcome = setStatus(getDb(), systemClock, id, parsed.data.status);
  if (outcome.kind === "not_found") return Response.json({ error: "unknown experiment" }, { status: 404 });
  const e = outcome.experiment;
  return Response.json({
    result: outcome.kind,
    experiment: { id: e.id, status: e.status, pausedAt: e.pausedAt === null ? null : formatInstant(e.pausedAt) },
  });
}
