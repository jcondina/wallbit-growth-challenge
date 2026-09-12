import { createHash } from "node:crypto";
import type { Experiment, Variant } from "./experiment";

/**
 * Deterministic variant assignment.
 *
 * bucket = sha256("{experimentId}:{userId}")[0..8] as uint32, mod 100.
 * The experiment id is part of the hash so two experiments running on the
 * same users get independent splits. `scripts/verify.py` replicates this
 * formula exactly, on purpose, in a different language.
 *
 * The persisted `assignments` row is the source of truth once it exists; this
 * function is only consulted on first enrollment. That keeps allocation
 * changes from reshuffling users who were already assigned.
 */

export const BUCKETS = 100;

export function hashBucket(experimentId: string, userId: string): number {
  const hex = createHash("sha256").update(`${experimentId}:${userId}`).digest("hex");
  return Number.parseInt(hex.slice(0, 8), 16) % BUCKETS;
}

export function variantFor(exp: Experiment, userId: string): Variant {
  const bucket = hashBucket(exp.id, userId);
  let cumulative = 0;
  for (const { variant, weight } of exp.allocation) {
    cumulative += weight;
    if (bucket < cumulative) return variant;
  }
  // Unreachable when weights sum to 100 (validated at load); kept as a safe default.
  return exp.allocation[exp.allocation.length - 1].variant;
}
