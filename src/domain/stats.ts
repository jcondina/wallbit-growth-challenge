/**
 * Statistics for a two-proportion experiment. Pure functions; every one
 * returns `null` instead of NaN when the inputs cannot support the answer
 * (empty arm, degenerate pooled rate), so the dashboard can say
 * "datos insuficientes" rather than render a nonsense number.
 *
 * Conventions: rates are fractions (0.382), differences are in fractions
 * too; the presentation layer turns them into "38,2 %" and "−6,3 pp".
 */

export interface Proportion {
  /** successes */
  k: number;
  /** trials */
  n: number;
}

// Two-sided 95 % and 80 % power — the only quantiles we need.
export const Z_ALPHA_95 = 1.959964;
export const Z_POWER_80 = 0.841621;

export function rate(p: Proportion): number | null {
  return p.n === 0 ? null : p.k / p.n;
}

/** Standard normal CDF via the Abramowitz–Stegun 7.1.26 erf approximation (|error| < 1.5e-7). */
export function normalCdf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * ax);
  const poly =
    t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - poly * Math.exp(-ax * ax);
  return 0.5 * (1 + sign * erf);
}

/** Wilson score interval — behaves at small n and near 0/1, unlike Wald. */
export function wilsonCI(p: Proportion, z = Z_ALPHA_95): [number, number] | null {
  if (p.n === 0) return null;
  const phat = p.k / p.n;
  const z2n = (z * z) / p.n;
  const center = (phat + z2n / 2) / (1 + z2n);
  const half = (z * Math.sqrt((phat * (1 - phat)) / p.n + z2n / (4 * p.n))) / (1 + z2n);
  return [Math.max(0, center - half), Math.min(1, center + half)];
}

export interface ZTest {
  z: number;
  /** two-sided */
  p: number;
}

/** Two-proportion z-test with pooled standard error, treatment minus control. */
export function twoProportionZTest(control: Proportion, treatment: Proportion): ZTest | null {
  if (control.n === 0 || treatment.n === 0) return null;
  const pooled = (control.k + treatment.k) / (control.n + treatment.n);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / control.n + 1 / treatment.n));
  if (se === 0) return null;
  const z = (treatment.k / treatment.n - control.k / control.n) / se;
  return { z, p: 2 * (1 - normalCdf(Math.abs(z))) };
}

/** Wald interval on the difference (treatment − control) with unpooled SE. */
export function differenceCI(control: Proportion, treatment: Proportion, z = Z_ALPHA_95): [number, number] | null {
  if (control.n === 0 || treatment.n === 0) return null;
  const pa = control.k / control.n;
  const pb = treatment.k / treatment.n;
  const se = Math.sqrt((pa * (1 - pa)) / control.n + (pb * (1 - pb)) / treatment.n);
  const d = pb - pa;
  return [d - z * se, d + z * se];
}

/**
 * Minimum detectable effect (absolute, as a fraction) at the given arm sizes:
 * the smallest true lift that a two-sided α test would find with `power`.
 */
export function minDetectableEffect(
  baseRate: number,
  nControl: number,
  nTreatment: number,
  zAlpha = Z_ALPHA_95,
  zPower = Z_POWER_80,
): number | null {
  if (nControl === 0 || nTreatment === 0) return null;
  return (zAlpha + zPower) * Math.sqrt(baseRate * (1 - baseRate) * (1 / nControl + 1 / nTreatment));
}

/** Users per arm needed to detect p1 → p2 (two-sided α, given power). */
export function requiredPerArm(p1: number, p2: number, zAlpha = Z_ALPHA_95, zPower = Z_POWER_80): number | null {
  if (p1 === p2) return null;
  const pbar = (p1 + p2) / 2;
  const numerator =
    zAlpha * Math.sqrt(2 * pbar * (1 - pbar)) + zPower * Math.sqrt(p1 * (1 - p1) + p2 * (1 - p2));
  return Math.ceil((numerator * numerator) / ((p2 - p1) * (p2 - p1)));
}

/**
 * P(treatment rate > control rate) under Beta(1+k, 1+n−k) posteriors with
 * uniform priors, using the normal approximation of each posterior. Same
 * information as the confidence interval, phrased as a probability.
 * Adequate for n ≳ 50 per arm; the dashboard labels it as an approximation.
 */
export function probabilityTreatmentBeats(control: Proportion, treatment: Proportion): number | null {
  if (control.n === 0 || treatment.n === 0) return null;
  const moments = ({ k, n }: Proportion) => {
    const a = 1 + k;
    const b = 1 + n - k;
    const mean = a / (a + b);
    const variance = (a * b) / ((a + b) * (a + b) * (a + b + 1));
    return { mean, variance };
  };
  const c = moments(control);
  const t = moments(treatment);
  const se = Math.sqrt(c.variance + t.variance);
  if (se === 0) return null;
  return normalCdf((t.mean - c.mean) / se);
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
