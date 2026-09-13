import type { EventName, EventSource } from "./events";
import type { Variant } from "./experiment";
import { median } from "./stats";
import type { Instant } from "./time";

/**
 * Funnel over the event log — "¿dónde se traba la gente?".
 *
 * Counts UNIQUE USERS per step, never events, and only among enrolled users
 * who were exposed (have a funding_screen_viewed). Deposit steps come from
 * the webhook-derived events. A user's funnel variant is what the screen
 * showed at first exposure, which is what they actually experienced.
 *
 * How it reads: events are sorted once, grouped per user, and each user's
 * events are folded into a `UserTrail` (what they did, in order). Every
 * number on the page is a count or a median over trails, so delivery order
 * cannot change a result.
 */

export interface FunnelEvent {
  name: EventName;
  userId: string;
  variantShown: string | null;
  occurredAt: Instant;
  source: EventSource;
  props: Record<string, unknown>;
}

export type Step = "viewed" | "selected" | "copied" | "received" | "completed";
export const STEPS: Step[] = ["viewed", "selected", "copied", "received", "completed"];

export interface StepCounts extends Record<Step, number> {
  failed: number;
}

export interface Drop {
  from: Step;
  to: Step;
  users: number;
  /** fraction of `from` users lost before `to` */
  rate: number;
}

export interface VariantFunnel {
  variant: Variant;
  steps: StepCounts;
  /** step-to-step conversion as fractions; null when the previous step is empty */
  conversion: Record<Exclude<Step, "viewed">, number | null>;
  largestDrop: Drop | null;
  medianMsToSelect: number | null;
  medianMsToCopy: number | null;
  /** distinct users who opened "ver otras opciones" */
  expanded: number;
  /** distinct users whose first selection was the recommended method */
  selectedRecommendedFirst: number;
}

export interface MethodFunnel {
  methodId: string;
  selected: number;
  copied: number;
  received: number;
  completed: number;
  failed: number;
}

export interface FrictionSignals {
  /** distinct methods selected per user, among users who selected: 1 / 2 / 3+ */
  indecision: { one: number; two: number; threePlus: number };
  /** ≥ 2 screen views and no deposit detected */
  loopers: number;
  /** last funding_screen_left per user, by last_step */
  abandonedAt: { viewed: number; selected: number; copied: number };
  /** last selected method differs from the method of the first deposit detected */
  selectedNotDeposited: number;
  /** enrolled users with deposit events but no screen view (e.g. the simulated month) */
  unexposedDepositors: number;
}

export interface FunnelSummary {
  exposedUsers: number;
  byVariant: VariantFunnel[];
  byMethod: MethodFunnel[];
  friction: FrictionSignals;
}

type LastStep = "viewed" | "selected" | "copied";

/** One user's journey, every list in chronological order. */
interface UserTrail {
  variant: Variant;
  views: number;
  selected: { methodId: string; recommended: boolean; msSinceView: number }[];
  copied: { methodId: string; msSinceSelect: number }[];
  expanded: boolean;
  lastLeft: LastStep | null;
  received: { methodId: string }[];
  completed: { methodId: string }[];
  failed: { methodId: string }[];
}

export function computeFunnel(
  events: FunnelEvent[],
  variantByUser: Map<string, Variant>,
  variants: Variant[],
): FunnelSummary {
  const chronological = events.toSorted((a, b) => a.occurredAt - b.occurredAt || a.name.localeCompare(b.name));

  const trails: UserTrail[] = [];
  for (const [userId, userEvents] of Map.groupBy(chronological, (e) => e.userId)) {
    const assigned = variantByUser.get(userId);
    if (assigned !== undefined) trails.push(trailFor(userEvents, assigned)); // not enrolled → not in the funnel
  }
  const exposed = trails.filter((t) => t.views > 0);

  return {
    exposedUsers: exposed.length,
    byVariant: variants.map((variant) => variantFunnel(variant, exposed.filter((t) => t.variant === variant))),
    byMethod: methodFunnels(exposed),
    friction: frictionSignals(trails, exposed),
  };
}

// ---- one user ---------------------------------------------------------------

const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown) => (typeof v === "number" ? v : 0);
const method = (e: FunnelEvent) => ({ methodId: str(e.props.method_id) });

function trailFor(events: FunnelEvent[], assigned: Variant): UserTrail {
  const by = Object.groupBy(events, (e) => e.name);
  const views = by.funding_screen_viewed ?? [];
  return {
    variant: views[0]?.variantShown ?? assigned,
    views: views.length,
    selected: (by.funding_method_selected ?? []).map((e) => ({
      methodId: str(e.props.method_id),
      recommended: e.props.is_recommended === true,
      msSinceView: num(e.props.ms_since_view),
    })),
    copied: (by.funding_details_copied ?? []).map((e) => ({
      methodId: str(e.props.method_id),
      msSinceSelect: num(e.props.ms_since_select),
    })),
    expanded: (by.funding_options_expanded ?? []).length > 0,
    lastLeft: (str(by.funding_screen_left?.at(-1)?.props.last_step) || null) as LastStep | null,
    received: (by.deposit_received ?? []).map(method),
    completed: (by.deposit_completed ?? []).map(method),
    failed: (by.deposit_failed ?? []).map(method),
  };
}

// ---- per variant -----------------------------------------------------------

function variantFunnel(variant: Variant, trails: UserTrail[]): VariantFunnel {
  const count = (pick: (t: UserTrail) => boolean) => trails.filter(pick).length;
  const steps: StepCounts = {
    viewed: trails.length,
    selected: count((t) => t.selected.length > 0),
    copied: count((t) => t.copied.length > 0),
    received: count((t) => t.received.length > 0),
    completed: count((t) => t.completed.length > 0),
    failed: count((t) => t.failed.length > 0),
  };

  const ratio = (from: number, to: number) => (from === 0 ? null : to / from);
  const conversion = {
    selected: ratio(steps.viewed, steps.selected),
    copied: ratio(steps.selected, steps.copied),
    received: ratio(steps.copied, steps.received),
    completed: ratio(steps.received, steps.completed),
  };

  const drops: Drop[] = [];
  for (let i = 1; i < STEPS.length; i++) {
    const [from, to] = [STEPS[i - 1], STEPS[i]];
    const users = steps[from] - steps[to];
    if (steps[from] > 0 && users > 0) drops.push({ from, to, users, rate: users / steps[from] });
  }

  const withSelection = trails.filter((t) => t.selected.length > 0);
  const withCopy = trails.filter((t) => t.copied.length > 0);
  return {
    variant,
    steps,
    conversion,
    largestDrop: drops.toSorted((a, b) => b.rate - a.rate)[0] ?? null,
    medianMsToSelect: median(withSelection.map((t) => t.selected[0].msSinceView)),
    medianMsToCopy: median(withCopy.map((t) => t.copied[0].msSinceSelect)),
    expanded: count((t) => t.expanded),
    selectedRecommendedFirst: withSelection.filter((t) => t.selected[0].recommended).length,
  };
}

// ---- per method ------------------------------------------------------------

function methodFunnels(trails: UserTrail[]): MethodFunnel[] {
  const rows = new Map<string, MethodFunnel>();
  const row = (id: string) => {
    if (!rows.has(id)) rows.set(id, { methodId: id, selected: 0, copied: 0, received: 0, completed: 0, failed: 0 });
    return rows.get(id) as MethodFunnel;
  };
  const distinctIds = (items: { methodId: string }[]) => new Set(items.map((i) => i.methodId));

  for (const t of trails) {
    for (const id of distinctIds(t.selected)) row(id).selected += 1;
    for (const id of distinctIds(t.copied)) row(id).copied += 1;
    for (const id of distinctIds(t.received)) row(id).received += 1;
    for (const id of distinctIds(t.completed)) row(id).completed += 1;
    for (const id of distinctIds(t.failed)) row(id).failed += 1;
  }
  return [...rows.values()].toSorted((a, b) => b.selected - a.selected || a.methodId.localeCompare(b.methodId));
}

// ---- friction --------------------------------------------------------------

function frictionSignals(all: UserTrail[], exposed: UserTrail[]): FrictionSignals {
  const indecision = { one: 0, two: 0, threePlus: 0 };
  for (const t of exposed) {
    const distinct = new Set(t.selected.map((s) => s.methodId)).size;
    if (distinct === 1) indecision.one += 1;
    else if (distinct === 2) indecision.two += 1;
    else if (distinct >= 3) indecision.threePlus += 1;
  }

  const abandonedAt = { viewed: 0, selected: 0, copied: 0 };
  for (const t of exposed) if (t.lastLeft) abandonedAt[t.lastLeft] += 1;

  return {
    indecision,
    loopers: exposed.filter((t) => t.views >= 2 && t.received.length === 0).length,
    abandonedAt,
    selectedNotDeposited: exposed.filter(
      (t) => t.selected.length > 0 && t.received.length > 0 && t.selected.at(-1)?.methodId !== t.received[0].methodId,
    ).length,
    unexposedDepositors: all.filter((t) => t.views === 0 && t.received.length > 0).length,
  };
}
