import { variantFor } from "@/domain/assignment";
import { SCHEMA_VERSION, assignmentEventId } from "@/domain/events";
import { CONTROL_VARIANT, type Experiment, type Variant, isEligible, isRunning } from "@/domain/experiment";
import type { Clock } from "@/domain/time";
import { type Db, tx } from "@/infra/db";
import { type Assignment, getAssignment, insertAssignmentIfMissing } from "@/infra/repos/assignments";
import { insertEventIfMissing } from "@/infra/repos/events";
import type { User } from "@/infra/repos/users";

/**
 * Decides what a user sees on the funding screen, enrolling them if this is
 * their first touch.
 *
 *   preview      → the requested variant, nothing written, nothing tracked
 *   ineligible   → control; pre-experiment users are never enrolled
 *   assigned     → their stored variant while the experiment runs
 *   paused       → control, even for B-assigned users; the assignment stays
 *   first touch  → hash → INSERT OR IGNORE → read back (concurrent first
 *                  visits compute the same variant, so there is no race)
 *
 * The seed already enrolls every eligible user at signup, so in practice
 * "first touch" only happens for a user created after the seed.
 */

export type EnrollReason = "preview" | "ineligible" | "assigned" | "enrolled" | "paused" | "finished";

export interface EnrollOutcome {
  variantShown: Variant;
  assignment: Assignment | null;
  reason: EnrollReason;
}

/** A non-running experiment shows control; the reason names why. */
function stoppedReason(experiment: Experiment): "paused" | "finished" {
  return experiment.status === "paused" ? "paused" : "finished";
}

export class UnknownVariant extends Error {
  constructor(variant: string) {
    super(`variant ${variant} is not in the experiment's allocation`);
    this.name = "UnknownVariant";
  }
}

export function enrollUser(
  db: Db,
  clock: Clock,
  user: User,
  experiment: Experiment,
  options: { preview?: Variant | null } = {},
): EnrollOutcome {
  if (options.preview) {
    if (!experiment.allocation.some((a) => a.variant === options.preview)) throw new UnknownVariant(options.preview);
    return { variantShown: options.preview, assignment: null, reason: "preview" };
  }

  if (!isEligible(experiment, user)) return { variantShown: CONTROL_VARIANT, assignment: null, reason: "ineligible" };

  const existing = getAssignment(db, experiment.id, user.id);
  if (existing) {
    return isRunning(experiment)
      ? { variantShown: existing.variant, assignment: existing, reason: "assigned" }
      : { variantShown: CONTROL_VARIANT, assignment: existing, reason: stoppedReason(experiment) };
  }

  if (!isRunning(experiment)) return { variantShown: CONTROL_VARIANT, assignment: null, reason: stoppedReason(experiment) };

  const now = clock.now();
  const variant = variantFor(experiment, user.id);
  const assignment = tx(db, () => {
    insertAssignmentIfMissing(db, {
      experimentId: experiment.id,
      userId: user.id,
      variant,
      allocationVersion: experiment.allocationVersion,
      assignedAt: now,
    });
    insertEventIfMissing(db, {
      eventId: assignmentEventId(experiment.id, user.id),
      name: "experiment_assigned",
      userId: user.id,
      occurredAt: now,
      recordedAt: now,
      source: "system",
      experimentId: experiment.id,
      variantShown: null,
      country: user.country,
      sessionId: null,
      schemaVersion: SCHEMA_VERSION,
      props: { variant, allocation_version: experiment.allocationVersion },
    });
    return getAssignment(db, experiment.id, user.id);
  });
  if (!assignment) throw new Error(`assignment for ${user.id} missing after insert`);
  return { variantShown: assignment.variant, assignment, reason: "enrolled" };
}
