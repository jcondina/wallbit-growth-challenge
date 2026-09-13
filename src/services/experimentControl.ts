import type { Experiment, ExperimentStatus } from "@/domain/experiment";
import type { Clock } from "@/domain/time";
import type { Db } from "@/infra/db";
import { getExperiment, setExperimentStatus } from "@/infra/repos/experiments";

/**
 * The kill switch. Pausing makes every funding screen render control and
 * stops new enrollments; existing assignments are untouched so the readout
 * keeps reporting the frozen cohort. Resuming restores the assigned
 * variants. Unauthenticated by design of this exercise — stated in ENTREGA.
 */

export type ControlOutcome = { kind: "not_found" } | { kind: "unchanged"; experiment: Experiment } | { kind: "updated"; experiment: Experiment };

export function setStatus(db: Db, clock: Clock, experimentId: string, status: Exclude<ExperimentStatus, "finished"> | "finished"): ControlOutcome {
  const current = getExperiment(db, experimentId);
  if (!current) return { kind: "not_found" };
  if (current.status === status) return { kind: "unchanged", experiment: current };

  const pausedAt = status === "paused" ? clock.now() : null;
  setExperimentStatus(db, experimentId, status, pausedAt);
  const updated = getExperiment(db, experimentId);
  if (!updated) return { kind: "not_found" };
  return { kind: "updated", experiment: updated };
}
