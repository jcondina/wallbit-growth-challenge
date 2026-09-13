import { z } from "zod";
import { systemClock } from "@/domain/time";
import { webhookConfig } from "@/infra/config";
import { getDb } from "@/infra/db";
import { FUNDING_EXPERIMENT } from "@/domain/experiment";
import { getExperiment } from "@/infra/repos/experiments";
import { JOURNEYS, batchPool, deleteSimulatedData, simulateBatch, simulateJourney, simulatedCounts } from "@/services/simulateJourney";

const Body = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("one"), userId: z.string().min(1).max(64), journey: z.enum(JOURNEYS) }).strict(),
  z.object({ mode: z.literal("batch"), users: z.number().int().min(1).max(600), seed: z.number().int().min(0), freshOnly: z.boolean().optional() }).strict(),
  z.object({ mode: z.literal("reset") }).strict(),
]);

// POST /api/simulate — dev tool: emits journeys through the real services,
// or removes everything the simulator wrote. No auth, like /admin.
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid body", issues: parsed.error.issues.map((i) => i.message) }, { status: 400 });

  const db = getDb();
  const deps = { db, clock: systemClock, secret: webhookConfig().secret };
  const body = parsed.data;
  try {
    switch (body.mode) {
      case "one":
        return Response.json({ reports: [simulateJourney(deps, body.userId, body.journey)], counts: simulatedCounts(db) });
      case "batch": {
        // `pool` is how many users the batch could draw from, so a short
        // batch (fewer reports than asked) explains itself.
        const experiment = getExperiment(db, FUNDING_EXPERIMENT.id);
        const pool = experiment ? batchPool(db, experiment, body.freshOnly ?? true).length : 0;
        const reports = simulateBatch(deps, { users: body.users, seed: body.seed, freshOnly: body.freshOnly });
        return Response.json({ reports, requested: body.users, pool, counts: simulatedCounts(db) });
      }
      case "reset":
        return Response.json({ removed: deleteSimulatedData(db), counts: simulatedCounts(db) });
    }
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
