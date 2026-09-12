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
const ISO_WITH_ZONE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/;

/** The only door in. Accepts `…Z` or an explicit `±HH:MM` offset; throws on anything else. */
export function parseInstant(raw: unknown): Instant {
  if (typeof raw !== "string") throw new InvalidInstant(raw);
  const m = ISO_WITH_ZONE.exec(raw);
  if (!m) throw new InvalidInstant(raw);

  const [, y, mo, d, h, mi, s, frac, zone] = m;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  const hour = Number(h);
  const minute = Number(mi);
  const second = Number(s);
  const millis = frac === undefined ? 0 : Number(frac.padEnd(3, "0"));

  if (month < 1 || month > 12 || day < 1 || day > 31) throw new InvalidInstant(raw);
  if (hour > 23 || minute > 59 || second > 59) throw new InvalidInstant(raw);

  // Date.UTC never consults the process time zone. Round-trip the calendar
  // fields to reject dates that only "exist" by overflow (e.g. February 30).
  const utc = Date.UTC(year, month - 1, day, hour, minute, second, millis);
  const check = new Date(utc);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    throw new InvalidInstant(raw);
  }

  let offsetMs = 0;
  if (zone !== "Z") {
    const sign = zone.startsWith("-") ? -1 : 1;
    const offH = Number(zone.slice(1, 3));
    const offM = Number(zone.slice(4, 6));
    if (offH > 23 || offM > 59) throw new InvalidInstant(raw);
    offsetMs = sign * (offH * 60 + offM) * 60_000;
  }

  // "17:22:31+03:00" is 14:22:31Z — local wall time minus the offset.
  return (utc - offsetMs) as Instant;
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
