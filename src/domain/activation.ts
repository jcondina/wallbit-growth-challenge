import type { DepositState } from "./deposit";
import { type Duration, type Instant, isWithin, plus } from "./time";

/**
 * The activation metric, in one place.
 *
 *   activated ⇔ the user's first *credited* deposit (`completed`) happened
 *   within `window` of signup, inclusive, measured on the provider's
 *   occurred_at. `received` never counts, `failed` never counts, a
 *   `conflict` deposit never counts, and a completion after the window is a
 *   deposit but not an activation.
 *
 * Both cohorts (experiment and pre-experiment baseline) are read through
 * this file, so they cannot drift apart in definition.
 */

export interface ActivationSummary {
  signupAt: Instant;
  windowEndsAt: Instant;
  /** Earliest completed_at over the user's credited deposits. */
  firstCompletedAt: Instant | null;
  /** Earliest initiated_at over the user's credited deposits (timing of the deposit that eventually landed). */
  firstInitiatedAt: Instant | null;
  activated: boolean;
  /** Credited, but after the window closed. */
  lateConversion: boolean;
  /** Initiated a deposit-that-credited within the window (what the screen directly influences). */
  initiatedInWindow: boolean;
  /** The window had already closed at `asOf`; a non-activation is final only when this is true. */
  windowClosed: boolean;
}

export function firstCompletedAt(deposits: DepositState[]): Instant | null {
  return earliest(deposits.filter((d) => d.status === "completed").map((d) => d.completedAt));
}

export function firstInitiatedAt(deposits: DepositState[]): Instant | null {
  return earliest(deposits.filter((d) => d.status === "completed").map((d) => d.initiatedAt));
}

export function isActivated(signupAt: Instant, completedAt: Instant | null, window: Duration): boolean {
  return completedAt !== null && isWithin(signupAt, completedAt, window);
}

export function summarizeActivation(
  signupAt: Instant,
  deposits: DepositState[],
  window: Duration,
  asOf: Instant,
): ActivationSummary {
  const completedAt = firstCompletedAt(deposits);
  const initiatedAt = firstInitiatedAt(deposits);
  const windowEndsAt = plus(signupAt, window);
  const activated = isActivated(signupAt, completedAt, window);
  return {
    signupAt,
    windowEndsAt,
    firstCompletedAt: completedAt,
    firstInitiatedAt: initiatedAt,
    activated,
    lateConversion: completedAt !== null && !activated,
    initiatedInWindow: initiatedAt !== null && isWithin(signupAt, initiatedAt, window),
    windowClosed: windowEndsAt <= asOf,
  };
}

function earliest(values: (Instant | null)[]): Instant | null {
  let min: Instant | null = null;
  for (const v of values) if (v !== null && (min === null || v < min)) min = v;
  return min;
}
