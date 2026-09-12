import type { Instant } from "@/domain/time";

/**
 * Presentation-only formatting. es-AR conventions: comma decimals, dot
 * thousands, "38,2 %". Every timestamp is printed in UTC with the suffix —
 * this is the only place in the app where an Instant meets a locale.
 */

const es = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 });
const es1 = new Intl.NumberFormat("es-AR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const es2 = new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const es3 = new Intl.NumberFormat("es-AR", { minimumFractionDigits: 3, maximumFractionDigits: 3 });

export const formatInt = (n: number): string => es.format(n);

/** 0.382 → "38,2 %" */
export const formatPct = (fraction: number | null, digits: 1 | 0 = 1): string =>
  fraction === null ? "—" : `${(digits === 1 ? es1 : es).format(fraction * 100)} %`;

/** −0.063 → "−6,3 pp" (explicit sign) */
export const formatPp = (fraction: number | null): string => {
  if (fraction === null) return "—";
  const v = fraction * 100;
  const sign = v > 0 ? "+" : v < 0 ? "−" : "";
  return `${sign}${es1.format(Math.abs(v))} pp`;
};

/** [−0.139, 0.014] → "−13,9 a +1,4 pp" */
export const formatPpRange = (range: [number, number] | null): string =>
  range === null ? "—" : `${formatPp(range[0]).replace(" pp", "")} a ${formatPp(range[1])}`;

/** [0.327, 0.437] → "32,7 – 43,7 %" */
export const formatPctRange = (range: [number, number] | null): string =>
  range === null ? "—" : `${es1.format(range[0] * 100)} – ${es1.format(range[1] * 100)} %`;

export const formatP = (p: number | null): string => {
  if (p === null) return "—";
  if (p < 0.001) return "p < 0,001";
  return `p = ${(p < 0.01 ? es3 : es2).format(p)}`;
};

export const formatUsd = (n: number | null): string => (n === null ? "—" : `$ ${es.format(n)}`);

export const formatDays = (d: number | null): string => (d === null ? "—" : `${es1.format(d)} d`);

export const formatHours = (h: number | null): string => (h === null ? "—" : `${es1.format(h)} h`);

const utcDate = new Intl.DateTimeFormat("es-AR", {
  timeZone: "UTC",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** 2026-08-30T15:27:00Z → "30/08/2026 15:27 UTC" */
export const formatUtc = (i: Instant | null): string => (i === null ? "—" : `${utcDate.format(new Date(i))} UTC`);

/** "k / n = rate" — no lone percentages anywhere on the dashboard. */
export const formatRatio = (k: number, n: number): string =>
  n === 0 ? `0 / 0` : `${es.format(k)} / ${es.format(n)} = ${formatPct(k / n)}`;
