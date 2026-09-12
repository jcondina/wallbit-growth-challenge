import { type ActivationSummary, summarizeActivation } from "@/domain/activation";
import type { DepositState } from "@/domain/deposit";
import { CONTROL_VARIANT, type Experiment, type Variant, activationWindow } from "@/domain/experiment";
import { recommendedMethodFor } from "@/domain/recommendation";
import {
  type Proportion,
  type ZTest,
  differenceCI,
  median,
  minDetectableEffect,
  probabilityTreatmentBeats,
  requiredPerArm,
  twoProportionZTest,
  wilsonCI,
} from "@/domain/stats";
import { type Clock, type Duration, type Instant, elapsed, systemClock } from "@/domain/time";
import { type Verdict, decideVerdict } from "@/domain/verdict";
import { type Db, queryAll, queryRow } from "@/infra/db";
import { listAssignments } from "@/infra/repos/assignments";
import { type DepositRecord, listDeposits } from "@/infra/repos/deposits";
import { getExperiment } from "@/infra/repos/experiments";
import { listFundingMethods } from "@/infra/repos/fundingMethods";
import { type User, listUsers } from "@/infra/repos/users";
import { type InboxStats, inboxStats } from "@/infra/repos/webhookInbox";

/**
 * The results read model.
 *
 * One activation rule (domain/activation.ts), two cohorts:
 *   experiment — users with an assignment, grouped by variant
 *   baseline   — users who signed up before the experiment started
 * Deposits come from any source (webhook or historical), so the baseline is
 * measured with exactly the same definition as the experiment. Everything
 * is computed in memory: the whole dataset is a few thousand rows.
 */

export interface GroupStats {
  users: number;
  activated: number;
  rate: number | null;
  rateCI95: [number, number] | null;
  /** Initiated a deposit-that-credited within the window. */
  initiatedInWindow: number;
  /** Credited at some point, window or not. */
  everConverted: number;
  lateConversions: number;
  /** Users whose window had not closed at asOf. */
  pendingWindows: number;
  /** Median days from signup to initiating the deposit that eventually credited. */
  medianDaysToInitiate: number | null;
  /** Median hours from initiation to credit for the first credited deposit. */
  medianHoursToCredit: number | null;
  /** First credited deposit used the country's recommended method (among everConverted). */
  usedRecommended: Proportion | null;
  /** Failed / final, over webhook-sourced deposits only (historical data has no failures). */
  failureRate: Proportion | null;
  medianFirstDepositUsd: number | null;
}

export interface Comparison {
  control: Variant;
  treatment: Variant;
  difference: number | null;
  differenceCI95: [number, number] | null;
  test: ZTest | null;
}

export interface CountryCut {
  country: string;
  variants: Record<Variant, GroupStats>;
  comparison: Comparison | null;
  /** Any arm below 30 users. */
  smallSample: boolean;
}

export interface ClientFunnelStats {
  /** Distinct users with a funding_screen_viewed event, per variant shown. */
  exposed: Record<Variant, number>;
  /** Distinct users who opened "ver otras opciones" (variant B). */
  expanded: Record<Variant, number>;
  /** Distinct users who selected a method / the recommended one. */
  selected: Record<Variant, number>;
  selectedRecommended: Record<Variant, number>;
}

export interface DataQuality {
  inbox: InboxStats;
  duplicatesIgnored: number;
  deposits: { total: number; completed: number; failed: number; conflict: number; received: number };
  unknownUsers: number;
  assignmentsMissingForDepositors: number;
}

export interface PowerAnalysis {
  /** Rate the MDE and sample sizes are computed against (control rate, or baseline when control is empty). */
  baseRate: number | null;
  mde: number | null;
  probabilityTreatmentBeatsControl: number | null;
  signupsPerMonthObserved: number | null;
  table: { lift: number; usersNeeded: number | null; months: number | null }[];
}

export interface ExperimentResults {
  experiment: Experiment;
  asOf: Instant;
  dataThrough: Instant | null;
  variants: Record<Variant, GroupStats>;
  comparison: Comparison | null;
  verdict: Verdict | null;
  baseline: GroupStats & { byCountry: Record<string, GroupStats> };
  sanity: { controlVsBaseline: ZTest | null; consistent: boolean | null };
  client: ClientFunnelStats | null;
  byCountry: CountryCut[];
  dataQuality: DataQuality;
  power: PowerAnalysis;
}

export interface ResultsOptions {
  experimentId?: string;
  asOf?: Instant;
  clock?: Clock;
}

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const SMALL_SAMPLE = 30;

interface UserOutcome {
  user: User;
  variant: Variant | null;
  activation: ActivationSummary;
  firstCredited: DepositState | null;
  usedRecommended: boolean | null;
  webhookFinal: number;
  webhookFailed: number;
}

export function experimentResults(db: Db, options: ResultsOptions = {}): ExperimentResults {
  const experimentId = options.experimentId ?? "funding_recommended_v1";
  const experiment = getExperiment(db, experimentId);
  if (!experiment) throw new Error(`experiment ${experimentId} not found — run npm run seed`);

  const asOf = options.asOf ?? (options.clock ?? systemClock).now();
  const window = activationWindow(experiment);
  const methods = listFundingMethods(db);
  const users = listUsers(db);
  const deposits = listDeposits(db);
  const assignments = listAssignments(db, experiment.id);

  const depositsByUser = groupBy(deposits, (d) => d.userId);
  const variantByUser = new Map(assignments.map((a) => [a.userId, a.variant]));
  const recommendedByCountry = memo((country: string) => recommendedMethodFor(country, methods).id);

  const outcomes = users.map((user) =>
    outcomeFor(user, variantByUser.get(user.id) ?? null, depositsByUser.get(user.id) ?? [], window, asOf, recommendedByCountry),
  );
  const experimentCohort = outcomes.filter((o) => o.variant !== null);
  const baselineCohort = outcomes.filter((o) => o.user.createdAt < experiment.startsAt);

  // per variant, in allocation order so empty arms still appear
  const variants: Record<Variant, GroupStats> = {};
  for (const { variant } of experiment.allocation) {
    variants[variant] = aggregate(experimentCohort.filter((o) => o.variant === variant));
  }

  const control = CONTROL_VARIANT;
  const treatment = experiment.allocation.map((a) => a.variant).find((v) => v !== control) ?? null;
  const comparison = treatment === null ? null : compare(control, treatment, variants[control], variants[treatment]);

  const verdict =
    treatment === null
      ? null
      : decideVerdict({
          control: proportion(variants[control]),
          treatment: proportion(variants[treatment]),
          controlLabel: control,
          treatmentLabel: treatment,
          pendingWindows: variants[control].pendingWindows + variants[treatment].pendingWindows,
        });

  const baseline = {
    ...aggregate(baselineCohort),
    byCountry: mapValues(groupBy(baselineCohort, (o) => o.user.country), aggregate),
  };

  const controlVsBaseline = twoProportionZTest(proportion(baseline), proportion(variants[control]));
  const sanity = {
    controlVsBaseline,
    consistent: controlVsBaseline === null ? null : controlVsBaseline.p >= 0.05,
  };

  const byCountry: CountryCut[] = [...groupBy(experimentCohort, (o) => o.user.country).entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([country, group]) => {
      const perVariant: Record<Variant, GroupStats> = {};
      for (const { variant } of experiment.allocation) perVariant[variant] = aggregate(group.filter((o) => o.variant === variant));
      return {
        country,
        variants: perVariant,
        comparison: treatment === null ? null : compare(control, treatment, perVariant[control], perVariant[treatment]),
        smallSample: Object.values(perVariant).some((g) => g.users < SMALL_SAMPLE),
      };
    });

  return {
    experiment,
    asOf,
    dataThrough: inboxStats(db).lastOccurredAt,
    variants,
    comparison,
    verdict,
    baseline,
    sanity,
    client: clientFunnel(db, experiment),
    byCountry,
    dataQuality: dataQuality(db, deposits, users, variantByUser),
    power: power(variants[control], treatment === null ? null : variants[treatment], baseline, experimentCohort, asOf),
  };
}

// ---- per user -------------------------------------------------------------

function outcomeFor(
  user: User,
  variant: Variant | null,
  deposits: DepositRecord[],
  window: Duration,
  asOf: Instant,
  recommendedByCountry: (country: string) => string,
): UserOutcome {
  const activation = summarizeActivation(user.createdAt, deposits, window, asOf);
  const credited = deposits
    .filter((d) => d.status === "completed" && d.completedAt !== null)
    .sort((a, b) => (a.completedAt as number) - (b.completedAt as number));
  const firstCredited = credited[0] ?? null;
  const webhook = deposits.filter((d) => d.source === "webhook");
  return {
    user,
    variant,
    activation,
    firstCredited,
    usedRecommended: firstCredited === null ? null : firstCredited.methodId === recommendedByCountry(user.country),
    webhookFinal: webhook.filter((d) => d.status !== "received").length,
    webhookFailed: webhook.filter((d) => d.status === "failed").length,
  };
}

// ---- per group ------------------------------------------------------------

function aggregate(group: UserOutcome[]): GroupStats {
  const users = group.length;
  const activated = group.filter((o) => o.activation.activated).length;
  const converted = group.filter((o) => o.firstCredited !== null);
  const webhookFinal = sum(group, (o) => o.webhookFinal);
  const webhookFailed = sum(group, (o) => o.webhookFailed);
  const withRecommendation = converted.filter((o) => o.usedRecommended !== null);

  return {
    users,
    activated,
    rate: users === 0 ? null : activated / users,
    rateCI95: wilsonCI({ k: activated, n: users }),
    initiatedInWindow: group.filter((o) => o.activation.initiatedInWindow).length,
    everConverted: converted.length,
    lateConversions: group.filter((o) => o.activation.lateConversion).length,
    pendingWindows: group.filter((o) => !o.activation.windowClosed).length,
    medianDaysToInitiate: median(
      converted
        .filter((o) => o.activation.firstInitiatedAt !== null)
        .map((o) => elapsed(o.user.createdAt, o.activation.firstInitiatedAt as Instant) / DAY_MS),
    ),
    medianHoursToCredit: median(
      converted
        .filter((o) => o.firstCredited?.initiatedAt != null && o.firstCredited.completedAt != null)
        .map((o) => elapsed(o.firstCredited!.initiatedAt as Instant, o.firstCredited!.completedAt as Instant) / HOUR_MS),
    ),
    usedRecommended:
      withRecommendation.length === 0
        ? null
        : { k: withRecommendation.filter((o) => o.usedRecommended).length, n: withRecommendation.length },
    failureRate: webhookFinal === 0 ? null : { k: webhookFailed, n: webhookFinal },
    medianFirstDepositUsd: median(converted.map((o) => o.firstCredited!.amountUsd)),
  };
}

const proportion = (g: GroupStats): Proportion => ({ k: g.activated, n: g.users });

function compare(control: Variant, treatment: Variant, c: GroupStats, t: GroupStats): Comparison {
  const pc = proportion(c);
  const pt = proportion(t);
  return {
    control,
    treatment,
    difference: c.rate === null || t.rate === null ? null : t.rate - c.rate,
    differenceCI95: differenceCI(pc, pt),
    test: twoProportionZTest(pc, pt),
  };
}

// ---- client-side funnel (events written by the funding screen) -----------

function clientFunnel(db: Db, experiment: Experiment): ClientFunnelStats | null {
  const total = queryRow<{ n: number }>(db, "SELECT COUNT(*) AS n FROM events WHERE source = 'client' AND experiment_id = ?", experiment.id).n;
  if (total === 0) return null;

  const distinct = (name: string, extra = "") =>
    Object.fromEntries(
      queryAll<{ variant_shown: string; n: number }>(
        db,
        `SELECT variant_shown, COUNT(DISTINCT user_id) AS n FROM events
         WHERE source = 'client' AND experiment_id = ? AND name = ? ${extra}
         GROUP BY variant_shown`,
        experiment.id,
        name,
      ).map((r) => [r.variant_shown, r.n]),
    );

  return {
    exposed: distinct("funding_screen_viewed"),
    expanded: distinct("funding_options_expanded"),
    selected: distinct("funding_method_selected"),
    selectedRecommended: distinct("funding_method_selected", "AND json_extract(props, '$.is_recommended') = 1"),
  };
}

// ---- data quality ---------------------------------------------------------

function dataQuality(db: Db, deposits: DepositRecord[], users: User[], variantByUser: Map<string, Variant>): DataQuality {
  const inbox = inboxStats(db);
  const webhook = deposits.filter((d) => d.source === "webhook");
  const count = (status: DepositRecord["status"]) => webhook.filter((d) => d.status === status).length;
  const known = new Set(users.map((u) => u.id));
  return {
    inbox,
    duplicatesIgnored: inbox.deliveries - inbox.uniqueEvents,
    deposits: { total: webhook.length, completed: count("completed"), failed: count("failed"), conflict: count("conflict"), received: count("received") },
    unknownUsers: new Set(webhook.filter((d) => !known.has(d.userId)).map((d) => d.userId)).size,
    assignmentsMissingForDepositors: new Set(webhook.filter((d) => known.has(d.userId) && !variantByUser.has(d.userId)).map((d) => d.userId)).size,
  };
}

// ---- power ----------------------------------------------------------------

function power(control: GroupStats, treatment: GroupStats | null, baseline: GroupStats, cohort: UserOutcome[], asOf: Instant): PowerAnalysis {
  const baseRate = control.rate ?? baseline.rate;
  const nControl = control.users;
  const nTreatment = treatment?.users ?? 0;

  let signupsPerMonthObserved: number | null = null;
  if (cohort.length > 1) {
    const signups = cohort.map((o) => o.user.createdAt);
    const spanDays = Math.max(1, elapsed(Math.min(...signups) as Instant, Math.min(asOf, Math.max(...signups)) as Instant) / DAY_MS);
    signupsPerMonthObserved = (cohort.length / spanDays) * 30;
  }

  const table = [0.03, 0.05, 0.08, 0.1].map((lift) => {
    const perArm = baseRate === null ? null : requiredPerArm(baseRate, baseRate + lift);
    const usersNeeded = perArm === null ? null : perArm * 2;
    return {
      lift,
      usersNeeded,
      months: usersNeeded === null || signupsPerMonthObserved === null ? null : usersNeeded / signupsPerMonthObserved,
    };
  });

  return {
    baseRate,
    mde: baseRate === null ? null : minDetectableEffect(baseRate, nControl, nTreatment),
    probabilityTreatmentBeatsControl: treatment === null ? null : probabilityTreatmentBeats(proportion(control), proportion(treatment)),
    signupsPerMonthObserved,
    table,
  };
}

// ---- small helpers --------------------------------------------------------

function groupBy<T, K>(items: T[], key: (item: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const k = key(item);
    const bucket = map.get(k);
    if (bucket) bucket.push(item);
    else map.set(k, [item]);
  }
  return map;
}

function mapValues<V, R>(map: Map<string, V>, fn: (v: V) => R): Record<string, R> {
  return Object.fromEntries([...map.entries()].map(([k, v]) => [k, fn(v)]));
}

function memo<A extends string, R>(fn: (a: A) => R): (a: A) => R {
  const cache = new Map<A, R>();
  return (a) => {
    if (!cache.has(a)) cache.set(a, fn(a));
    return cache.get(a) as R;
  };
}

function sum<T>(items: T[], pick: (item: T) => number): number {
  return items.reduce((acc, item) => acc + pick(item), 0);
}
