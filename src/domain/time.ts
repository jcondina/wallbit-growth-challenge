/**
 * Time model.
 *
 * Business logic only ever handles *instants* — points on the global timeline,
 * represented as epoch milliseconds and branded so a plain number, a Date or a
 * string cannot be passed by accident. Civil time (dates, hours, "days", time
 * zones, DST) exists only at the presentation edge.
 *
 * This is the only module in `src/domain` allowed to reference `Date`
 * (enforced by tests/architecture.test.ts). Everything that comes from the
 * outside world (provider webhooks, fixture files, request bodies) enters
 * through `parseInstant`, which refuses anything ambiguous.
 */

export type Instant = number & { readonly __brand: "Instant" };
export type Duration = number & { readonly __brand: "Duration" };

export class InvalidInstant extends Error {
  constructor(raw: unknown) {
    super(`Invalid instant: ${JSON.stringify(raw)} (expected ISO-8601 with 'Z' or an explicit offset)`);
    this.name = "InvalidInstant";
  }
}

// YYYY-MM-DDTHH:MM:SS[.sss](Z|±HH:MM). A time zone designator is mandatory:
// a naive timestamp has no single meaning and is rejected rather than guessed.
// Field ranges are enforced here because Date.parse is lenient about them
// (it accepts 24:00:00 and rolls February 30 into March).
const ISO_WITH_ZONE =
  /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;

/** The only door in. Accepts `…Z` or an explicit `±HH:MM` offset; throws on anything else. */
export function parseInstant(raw: unknown): Instant {
  if (typeof raw !== "string") throw new InvalidInstant(raw);
  const match = ISO_WITH_ZONE.exec(raw);
  if (!match) throw new InvalidInstant(raw);

  // With an explicit zone, Date.parse is unambiguous and ignores the
  // process time zone (the ES date-time string format); it also applies the
  // offset for us. What it will not do is reject a day that only exists by
  // overflow, so the calendar day is checked separately.
  const [, year, month, day] = match.map(Number);
  if (new Date(Date.UTC(year, month - 1, day)).getUTCDate() !== day) throw new InvalidInstant(raw);

  const epochMs = Date.parse(raw);
  if (Number.isNaN(epochMs)) throw new InvalidInstant(raw);
  return epochMs as Instant;
}

/** Brands an integer that is already known to be epoch milliseconds (rows read from the database, test fixtures). */
export function instant(epochMs: number): Instant {
  if (!Number.isSafeInteger(epochMs)) throw new InvalidInstant(epochMs);
  return epochMs as Instant;
}

/** Canonical serialization: always UTC, always `YYYY-MM-DDTHH:MM:SS.sssZ`. */
export function formatInstant(i: Instant): string {
  return new Date(i).toISOString();
}

export function minutes(n: number): Duration {
  return (n * 60_000) as Duration;
}

export function hours(n: number): Duration {
  return (n * 3_600_000) as Duration;
}

/** A "day" here is exactly 24 hours. There is no calendar arithmetic anywhere in the codebase. */
export function days(n: number): Duration {
  return hours(24 * n);
}

export function elapsed(from: Instant, to: Instant): Duration {
  return (to - from) as Duration;
}

/** Durations as plain numbers, for medians and display. */
export const inHours = (d: Duration): number => d / 3_600_000;
export const inDays = (d: Duration): number => d / 86_400_000;

export function plus(i: Instant, d: Duration): Instant {
  return (i + d) as Instant;
}

/** `to` is at or after `from`, and no more than `max` later (inclusive on both ends). */
export function isWithin(from: Instant, to: Instant, max: Duration): boolean {
  return to >= from && elapsed(from, to) <= max;
}

/** Wall-clock source. Injected into services; used for metadata and anomaly detection, never inside a business rule. */
export interface Clock {
  now(): Instant;
}

export const systemClock: Clock = {
  now: () => Date.now() as Instant,
};

export function fixedClock(at: Instant): Clock {
  return { now: () => at };
}
