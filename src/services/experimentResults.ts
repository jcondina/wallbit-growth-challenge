import { type ActivationSummary, summarizeActivation } from "@/domain/activation";
import type { DepositState } from "@/domain/deposit";
import type { FundingMethod } from "@/domain/fundingMethod";
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
import { type Clock, type Duration, type Instant, elapsed, inDays, inHours, systemClock } from "@/domain/time";
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
 * measured with exactly the same definition as the experiment.
 *
 * How it reads, top to bottom: load everything once → one `UserOutcome` per
 * user → `aggregate()` any list of outcomes into `GroupStats` → the rest is
 * slicing (per variant, per country, baseline) and comparing. Everything is
 * in memory: the whole dataset is a few thousand rows.
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
  /** Deposits written by /simulate (ids dep_sim_*). Zero in a clean replay. */
  simulatedDeposits: number;
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

const SMALL_SAMPLE = 30;
const LIFTS_TO_TABULATE = [0.03, 0.05, 0.08, 0.1];

/** Everything the read model knows about one user, computed once. */
interface UserOutcome {
  user: User;
  variant: Variant | null;
  activation: ActivationSummary;
  /** The earliest credited deposit, if any. */
  firstCredited: DepositState | null;
  usedRecommended: boolean | null;
  /** Webhook-sourced deposits in a final state, and how many of those failed. */
  webhookFinal: number;
  webhookFailed: number;
}

export function experimentResults(db: Db, options: ResultsOptions = {}): ExperimentResults {
  const experiment = getExperiment(db, options.experimentId ?? "funding_recommended_v1");
  if (!experiment) throw new Error("experiment not found — run npm run seed");
  const asOf = options.asOf ?? (options.clock ?? systemClock).now();

  const users = listUsers(db);
  const deposits = listDeposits(db);
  const variantByUser = new Map(listAssignments(db, experiment.id).map((a) => [a.userId, a.variant]));
  const outcomes = outcomesFor(users, deposits, variantByUser, activationWindow(experiment), asOf, listFundingMethods(db));

  const cohort = outcomes.filter((o) => o.variant !== null);
  const baselineCohort = outcomes.filter((o) => o.user.createdAt < experiment.startsAt);

  const control = CONTROL_VARIANT;
  const treatment = experiment.allocation.map((a) => a.variant).find((v) => v !== control) ?? null;
  const variants = statsByVariant(experiment, cohort);
  const baseline = { ...aggregate(baselineCohort), byCountry: statsByCountry(baselineCohort) };
  const controlVsBaseline = twoProportionZTest(proportion(baseline), proportion(variants[control]));

  return {
    experiment,
    asOf,
    dataThrough: inboxStats(db).lastOccurredAt,
    variants,
    comparison: treatment === null ? null : compare(control, treatment, variants),
    verdict:
      treatment === null
        ? null
        : decideVerdict({
            control: proportion(variants[control]),
            treatment: proportion(variants[treatment]),
            controlLabel: control,
            treatmentLabel: treatment,
            pendingWindows: variants[control].pendingWindows + variants[treatment].pendingWindows,
          }),
    baseline,
    sanity: { controlVsBaseline, consistent: controlVsBaseline === null ? null : controlVsBaseline.p >= 0.05 },
    client: clientFunnel(db, experiment),
    byCountry: countryCuts(experiment, cohort, control, treatment),
    dataQuality: dataQuality(db, deposits, users, variantByUser),
    power: power(variants[control], treatment === null ? null : variants[treatment], baseline, cohort, asOf),
  };
}

// ---- per user -------------------------------------------------------------

function outcomesFor(
  users: User[],
  deposits: DepositRecord[],
  variantByUser: Map<string, Variant>,
  window: Duration,
  asOf: Instant,
  methods: FundingMethod[],
): UserOutcome[] {
  const depositsByUser = Map.groupBy(deposits, (d) => d.userId);
  const recommendedByCountry = new Map(
    [...new Set(users.map((u) => u.country))].map((c) => [c, recommendedMethodFor(c, methods).id]),
  );

  return users.map((user) => {
    const own = depositsByUser.get(user.id) ?? [];
    const credited = own.filter((d) => d.status === "completed").toSorted((a, b) => (a.completedAt ?? 0) - (b.completedAt ?? 0));
    const firstCredited = credited[0] ?? null;
    const webhookFinal = own.filter((d) => d.source === "webhook" && d.status !== "received");
    return {
      user,
      variant: variantByUser.get(user.id) ?? null,
      activation: summarizeActivation(user.createdAt, own, window, asOf),
      firstCredited,
      usedRecommended: firstCredited && firstCredited.methodId === recommendedByCountry.get(user.country),
      webhookFinal: webhookFinal.length,
      webhookFailed: webhookFinal.filter((d) => d.status === "failed").length,
    };
  });
}

// ---- per group ------------------------------------------------------------

/** Any list of outcomes → the numbers a table row needs. Used for variants, countries and the baseline alike. */
function aggregate(group: UserOutcome[]): GroupStats {
  const count = (pick: (o: UserOutcome) => boolean) => group.filter(pick).length;
  const users = group.length;
  const activated = count((o) => o.activation.activated);
  const converted = group.filter((o) => o.firstCredited !== null);
  const withRecommendation = converted.filter((o) => o.usedRecommended !== null);
  const webhookFinal = group.reduce((n, o) => n + o.webhookFinal, 0);
  const webhookFailed = group.reduce((n, o) => n + o.webhookFailed, 0);

  const daysToInitiate = converted.flatMap((o) =>
    o.activation.firstInitiatedAt === null ? [] : [inDays(elapsed(o.user.createdAt, o.activation.firstInitiatedAt))],
  );
  const hoursToCredit = converted.flatMap((o) => {
    const d = o.firstCredited;
    return d?.initiatedAt == null || d.completedAt == null ? [] : [inHours(elapsed(d.initiatedAt, d.completedAt))];
  });

  return {
    users,
    activated,
    rate: users === 0 ? null : activated / users,
    rateCI95: wilsonCI({ k: activated, n: users }),
    initiatedInWindow: count((o) => o.activation.initiatedInWindow),
    everConverted: converted.length,
    lateConversions: count((o) => o.activation.lateConversion),
    pendingWindows: count((o) => !o.activation.windowClosed),
    medianDaysToInitiate: median(daysToInitiate),
    medianHoursToCredit: median(hoursToCredit),
    usedRecommended:
      withRecommendation.length === 0 ? null : { k: withRecommendation.filter((o) => o.usedRecommended).length, n: withRecommendation.length },
    failureRate: webhookFinal === 0 ? null : { k: webhookFailed, n: webhookFinal },
    medianFirstDepositUsd: median(converted.map((o) => o.firstCredited?.amountUsd ?? 0)),
  };
}

const proportion = (g: GroupStats): Proportion => ({ k: g.activated, n: g.users });

/** In allocation order, so an empty arm still shows up as a row. */
function statsByVariant(experiment: Experiment, group: UserOutcome[]): Record<Variant, GroupStats> {
  return Object.fromEntries(experiment.allocation.map(({ variant }) => [variant, aggregate(group.filter((o) => o.variant === variant))]));
}

function statsByCountry(group: UserOutcome[]): Record<string, GroupStats> {
  return Object.fromEntries([...Map.groupBy(group, (o) => o.user.country)].map(([country, g]) => [country, aggregate(g)]));
}

function compare(control: Variant, treatment: Variant, stats: Record<Variant, GroupStats>): Comparison {
  const c = stats[control];
  const t = stats[treatment];
  return {
    control,
    treatment,
    difference: c.rate === null || t.rate === null ? null : t.rate - c.rate,
    differenceCI95: differenceCI(proportion(c), proportion(t)),
    test: twoProportionZTest(proportion(c), proportion(t)),
  };
}

function countryCuts(experiment: Experiment, cohort: UserOutcome[], control: Variant, treatment: Variant | null): CountryCut[] {
  return [...Map.groupBy(cohort, (o) => o.user.country)]
    .toSorted((a, b) => b[1].length - a[1].length)
    .map(([country, group]) => {
      const variants = statsByVariant(experiment, group);
      return {
        country,
        variants,
        comparison: treatment === null ? null : compare(control, treatment, variants),
        smallSample: Object.values(variants).some((g) => g.users < SMALL_SAMPLE),
      };
    });
}

// ---- client-side funnel (events written by the funding screen) -----------

function clientFunnel(db: Db, experiment: Experiment): ClientFunnelStats | null {
  const total = queryRow<{ n: number }>(db, "SELECT COUNT(*) AS n FROM events WHERE source = 'client' AND experiment_id = ?", experiment.id).n;
  if (total === 0) return null;

  const usersByVariant = (name: string, extra = "") =>
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
    exposed: usersByVariant("funding_screen_viewed"),
    expanded: usersByVariant("funding_options_expanded"),
    selected: usersByVariant("funding_method_selected"),
    selectedRecommended: usersByVariant("funding_method_selected", "AND json_extract(props, '$.is_recommended') = 1"),
  };
}

// ---- data quality ---------------------------------------------------------

function dataQuality(db: Db, deposits: DepositRecord[], users: User[], variantByUser: Map<string, Variant>): DataQuality {
  const inbox = inboxStats(db);
  const webhook = deposits.filter((d) => d.source === "webhook");
  const byStatus = Object.groupBy(webhook, (d) => d.status);
  const known = new Set(users.map((u) => u.id));
  const depositors = new Set(webhook.map((d) => d.userId));
  return {
    inbox,
    duplicatesIgnored: inbox.deliveries - inbox.uniqueEvents,
    simulatedDeposits: webhook.filter((d) => d.id.startsWith("dep_sim_")).length,
    deposits: {
      total: webhook.length,
      completed: byStatus.completed?.length ?? 0,
      failed: byStatus.failed?.length ?? 0,
      conflict: byStatus.conflict?.length ?? 0,
      received: byStatus.received?.length ?? 0,
    },
    unknownUsers: depositors.difference(known).size,
    assignmentsMissingForDepositors: depositors.intersection(known).difference(new Set(variantByUser.keys())).size,
  };
}

// ---- power ----------------------------------------------------------------

function power(control: GroupStats, treatment: GroupStats | null, baseline: GroupStats, cohort: UserOutcome[], asOf: Instant): PowerAnalysis {
  const baseRate = control.rate ?? baseline.rate;

  // Signup pace: cohort size over the span between its first and last signup.
  let signupsPerMonthObserved: number | null = null;
  if (cohort.length > 1) {
    const signups = cohort.map((o) => o.user.createdAt);
    const first = Math.min(...signups) as Instant;
    const last = Math.min(asOf, Math.max(...signups)) as Instant;
    signupsPerMonthObserved = (cohort.length / Math.max(1, inDays(elapsed(first, last)))) * 30;
  }

  const table = LIFTS_TO_TABULATE.map((lift) => {
    const perArm = baseRate === null ? null : requiredPerArm(baseRate, baseRate + lift);
    const usersNeeded = perArm === null ? null : perArm * 2;
    const months = usersNeeded === null || signupsPerMonthObserved === null ? null : usersNeeded / signupsPerMonthObserved;
    return { lift, usersNeeded, months };
  });

  return {
    baseRate,
    mde: baseRate === null ? null : minDetectableEffect(baseRate, control.users, treatment?.users ?? 0),
    probabilityTreatmentBeatsControl: treatment === null ? null : probabilityTreatmentBeats(proportion(control), proportion(treatment)),
    signupsPerMonthObserved,
    table,
  };
}
