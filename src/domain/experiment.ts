import { type Duration, type Instant, hours, parseInstant } from "./time";

/**
 * An experiment as data. Nothing in the domain hardcodes "A"/"B": variants
 * come from the allocation, and the screen mapping lives in the UI layer.
 */

export type Variant = string;
export type ExperimentStatus = "running" | "paused" | "finished";

export interface Allocation {
  variant: Variant;
  /** Percentage points; all weights of an experiment sum to 100. */
  weight: number;
}

export interface Experiment {
  id: string;
  name: string;
  startsAt: Instant;
  /** `null` = still open for enrollment. Bounds enrollment, never a user's own activation window. */
  endsAt: Instant | null;
  windowHours: number;
  status: ExperimentStatus;
  pausedAt: Instant | null;
  allocation: Allocation[];
  /** Bumped whenever the allocation changes, so results can be cut by it. */
  allocationVersion: number;
}

/** Shown to everyone who is not (or no longer) in the experiment. */
export const CONTROL_VARIANT: Variant = "A";

export const FUNDING_EXPERIMENT: Experiment = {
  id: "funding_recommended_v1",
  name: "Método recomendado por país en la pantalla de ingreso de dinero",
  // The brief says the experiment starts on 2026-08-01. All timestamps in the
  // material are UTC, so the cutoff is UTC midnight (Argentina midnight would
  // exclude 5 users for no reason the brief supports).
  startsAt: parseInstant("2026-08-01T00:00:00Z"),
  endsAt: null,
  windowHours: 168,
  status: "running",
  pausedAt: null,
  allocation: [
    { variant: "A", weight: 50 },
    { variant: "B", weight: 50 },
  ],
  allocationVersion: 1,
};

export class InvalidAllocation extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidAllocation";
  }
}

export function assertValidAllocation(allocation: Allocation[]): void {
  if (allocation.length === 0) throw new InvalidAllocation("allocation is empty");
  const seen = new Set<Variant>();
  let total = 0;
  for (const { variant, weight } of allocation) {
    if (seen.has(variant)) throw new InvalidAllocation(`variant ${variant} listed twice`);
    if (!Number.isInteger(weight) || weight <= 0) {
      throw new InvalidAllocation(`weight for ${variant} must be a positive integer`);
    }
    seen.add(variant);
    total += weight;
  }
  if (total !== 100) throw new InvalidAllocation(`weights sum to ${total}, expected 100`);
}

/** Eligible = signed up on/after the start and, if the experiment has ended, before the end. */
export function isEligible(exp: Experiment, user: { createdAt: Instant }): boolean {
  if (user.createdAt < exp.startsAt) return false;
  if (exp.endsAt !== null && user.createdAt >= exp.endsAt) return false;
  return true;
}

export function isRunning(exp: Experiment): boolean {
  return exp.status === "running";
}

/** The activation window as a duration from the user's signup instant. */
export function activationWindow(exp: Experiment): Duration {
  return hours(exp.windowHours);
}
