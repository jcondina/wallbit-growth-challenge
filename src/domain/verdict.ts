import { type Proportion, type ZTest, differenceCI, minDetectableEffect, twoProportionZTest } from "./stats";

/**
 * The verdict is computed, never written. It is the one sentence a Growth
 * reader takes away, so it is derived from thresholds that are printed next
 * to it. The Spanish wording lives in the presentation layer
 * (content/verdict.ts); this module only decides.
 *
 *   insufficient_data          an arm is below MIN_PER_ARM
 *   b_better / a_better        p < alpha, sign of the difference
 *   no_detectable_difference   otherwise — always accompanied by the MDE so
 *                              "not detected" is never read as "no effect"
 *   provisional                some users' windows were still open at asOf
 */

export type VerdictState = "insufficient_data" | "b_better" | "a_better" | "no_detectable_difference";

export const MIN_PER_ARM = 50;
export const DEFAULT_ALPHA = 0.05;

export interface VerdictInput {
  control: Proportion;
  treatment: Proportion;
  controlLabel: string;
  treatmentLabel: string;
  pendingWindows: number;
  alpha?: number;
  minPerArm?: number;
}

export interface Verdict {
  state: VerdictState;
  provisional: boolean;
  pendingWindows: number;
  controlLabel: string;
  treatmentLabel: string;
  alpha: number;
  minPerArm: number;
  /** treatment − control, as a fraction; null when an arm is empty */
  difference: number | null;
  differenceCI95: [number, number] | null;
  test: ZTest | null;
  /** Smallest absolute lift this experiment could have detected (80 % power), as a fraction. */
  mde: number | null;
}

export function decideVerdict(input: VerdictInput): Verdict {
  const alpha = input.alpha ?? DEFAULT_ALPHA;
  const minPerArm = input.minPerArm ?? MIN_PER_ARM;
  const { control, treatment } = input;

  const rateC = control.n === 0 ? null : control.k / control.n;
  const rateT = treatment.n === 0 ? null : treatment.k / treatment.n;
  const difference = rateC === null || rateT === null ? null : rateT - rateC;
  const test = twoProportionZTest(control, treatment);
  const mde = rateC === null ? null : minDetectableEffect(rateC, control.n, treatment.n);

  let state: VerdictState;
  if (control.n < minPerArm || treatment.n < minPerArm || test === null || difference === null) {
    state = "insufficient_data";
  } else if (test.p < alpha && difference > 0) {
    state = "b_better";
  } else if (test.p < alpha && difference < 0) {
    state = "a_better";
  } else {
    state = "no_detectable_difference";
  }

  return {
    state,
    provisional: input.pendingWindows > 0,
    pendingWindows: input.pendingWindows,
    controlLabel: input.controlLabel,
    treatmentLabel: input.treatmentLabel,
    alpha,
    minPerArm,
    difference,
    differenceCI95: differenceCI(control, treatment),
    test,
    mde,
  };
}
