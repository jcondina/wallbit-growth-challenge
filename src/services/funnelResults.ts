import type { EventEnvelope } from "@/domain/events";
import { type FunnelSummary, computeFunnel } from "@/domain/funnel";
import type { Db } from "@/infra/db";
import { listAssignments } from "@/infra/repos/assignments";
import { countVariantMismatches, listEventsForExperiment, listRecentEvents } from "@/infra/repos/events";
import { getExperiment } from "@/infra/repos/experiments";

export interface FunnelResults extends FunnelSummary {
  experimentId: string;
  enrolledUsers: number;
  /** Client events that showed a variant other than the stored assignment. */
  variantMismatches: number;
  /** Newest first — the live stream on /funnel. */
  recent: EventEnvelope[];
}

export function funnelResults(db: Db, experimentId = "funding_recommended_v1", recentLimit = 20): FunnelResults {
  const experiment = getExperiment(db, experimentId);
  if (!experiment) throw new Error(`experiment ${experimentId} not found — run npm run seed`);

  const assignments = listAssignments(db, experiment.id);
  const variantByUser = new Map(assignments.map((a) => [a.userId, a.variant]));
  const events = listEventsForExperiment(db, experiment.id);

  return {
    experimentId: experiment.id,
    enrolledUsers: assignments.length,
    ...computeFunnel(events, variantByUser, experiment.allocation.map((a) => a.variant)),
    variantMismatches: countVariantMismatches(db, experiment.id),
    recent: listRecentEvents(db, recentLimit),
  };
}
