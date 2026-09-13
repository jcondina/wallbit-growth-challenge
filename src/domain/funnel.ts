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
 * Every computation here is order-independent: events are grouped per user
 * first and folded with min/max/sets, so delivery order cannot change a
 * count.
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

interface UserTrail {
  variant: Variant;
  views: number;
  firstViewAt: Instant;
  selected: { methodId: string; at: Instant; recommended: boolean; msSinceView: number }[];
  copied: { methodId: string; at: Instant; msSinceSelect: number }[];
  expanded: boolean;
  lastLeft: { at: Instant; lastStep: "viewed" | "selected" | "copied" } | null;
  received: { methodId: string; at: Instant }[];
  completed: { methodId: string }[];
  failed: { methodId: string }[];
}

export function computeFunnel(
  events: FunnelEvent[],
  variantByUser: Map<string, Variant>,
  variants: Variant[],
): FunnelSummary {
  const trails = buildTrails(events, variantByUser);
  const exposed = [...trails.values()].filter((t) => t.views > 0);

  const byVariant = variants.map((variant) => variantFunnel(variant, exposed.filter((t) => t.variant === variant)));
  const byMethod = methodFunnels(exposed);
  const friction = frictionSignals(trails, exposed);

  return { exposedUsers: exposed.length, byVariant, byMethod, friction };
}

// ---- trails ----------------------------------------------------------------

function buildTrails(events: FunnelEvent[], variantByUser: Map<string, Variant>): Map<string, UserTrail> {
  const trails = new Map<string, UserTrail>();
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const num = (v: unknown) => (typeof v === "number" ? v : 0);

  for (const e of events) {
    const assigned = variantByUser.get(e.userId);
    if (assigned === undefined) continue; // not enrolled → not in the experiment funnel

    let t = trails.get(e.userId);
    if (!t) {
      t = { variant: assigned, views: 0, firstViewAt: e.occurredAt, selected: [], copied: [], expanded: false, lastLeft: null, received: [], completed: [], failed: [] };
      trails.set(e.userId, t);
    }

    switch (e.name) {
      case "funding_screen_viewed":
        if (t.views === 0 || e.occurredAt < t.firstViewAt) {
          t.firstViewAt = e.occurredAt;
          if (e.variantShown) t.variant = e.variantShown; // what they saw first
        }
        t.views += 1;
        break;
      case "funding_method_selected":
        t.selected.push({ methodId: str(e.props.method_id), at: e.occurredAt, recommended: e.props.is_recommended === true, msSinceView: num(e.props.ms_since_view) });
        break;
      case "funding_details_copied":
        t.copied.push({ methodId: str(e.props.method_id), at: e.occurredAt, msSinceSelect: num(e.props.ms_since_select) });
        break;
      case "funding_options_expanded":
        t.expanded = true;
        break;
      case "funding_screen_left": {
        const lastStep = str(e.props.last_step) as "viewed" | "selected" | "copied";
        if (!t.lastLeft || e.occurredAt > t.lastLeft.at) t.lastLeft = { at: e.occurredAt, lastStep };
        break;
      }
      case "deposit_received":
        t.received.push({ methodId: str(e.props.method_id), at: e.occurredAt });
        break;
      case "deposit_completed":
        t.completed.push({ methodId: str(e.props.method_id) });
        break;
      case "deposit_failed":
        t.failed.push({ methodId: str(e.props.method_id) });
        break;
      default:
        break;
    }
  }
  return trails;
}

// ---- per variant -----------------------------------------------------------

function variantFunnel(variant: Variant, trails: UserTrail[]): VariantFunnel {
  const steps: StepCounts = {
    viewed: trails.length,
    selected: trails.filter((t) => t.selected.length > 0).length,
    copied: trails.filter((t) => t.copied.length > 0).length,
    received: trails.filter((t) => t.received.length > 0).length,
    completed: trails.filter((t) => t.completed.length > 0).length,
    failed: trails.filter((t) => t.failed.length > 0).length,
  };
  const conv = (from: number, to: number) => (from === 0 ? null : to / from);
  const conversion = {
    selected: conv(steps.viewed, steps.selected),
    copied: conv(steps.selected, steps.copied),
    received: conv(steps.copied, steps.received),
    completed: conv(steps.received, steps.completed),
  };

  let largestDrop: Drop | null = null;
  for (let i = 1; i < STEPS.length; i++) {
    const from = STEPS[i - 1];
    const to = STEPS[i];
    if (steps[from] === 0) continue;
    const lost = steps[from] - steps[to];
    const rate = lost / steps[from];
    if (lost > 0 && (largestDrop === null || rate > largestDrop.rate)) largestDrop = { from, to, users: lost, rate };
  }

  const firstSelection = (t: UserTrail) => [...t.selected].sort((a, b) => a.at - b.at)[0];
  return {
    variant,
    steps,
    conversion,
    largestDrop,
    medianMsToSelect: median(trails.filter((t) => t.selected.length > 0).map((t) => firstSelection(t).msSinceView)),
    medianMsToCopy: median(trails.filter((t) => t.copied.length > 0).map((t) => [...t.copied].sort((a, b) => a.at - b.at)[0].msSinceSelect)),
    expanded: trails.filter((t) => t.expanded).length,
    selectedRecommendedFirst: trails.filter((t) => t.selected.length > 0 && firstSelection(t).recommended).length,
  };
}

// ---- per method ------------------------------------------------------------

function methodFunnels(trails: UserTrail[]): MethodFunnel[] {
  const rows = new Map<string, MethodFunnel>();
  const row = (id: string) => {
    let r = rows.get(id);
    if (!r) {
      r = { methodId: id, selected: 0, copied: 0, received: 0, completed: 0, failed: 0 };
      rows.set(id, r);
    }
    return r;
  };
  const uniqueIds = (items: { methodId: string }[]) => new Set(items.map((i) => i.methodId));

  for (const t of trails) {
    for (const id of uniqueIds(t.selected)) row(id).selected += 1;
    for (const id of uniqueIds(t.copied)) row(id).copied += 1;
    for (const id of uniqueIds(t.received)) row(id).received += 1;
    for (const id of uniqueIds(t.completed)) row(id).completed += 1;
    for (const id of uniqueIds(t.failed)) row(id).failed += 1;
  }
  return [...rows.values()].sort((a, b) => b.selected - a.selected || a.methodId.localeCompare(b.methodId));
}

// ---- friction --------------------------------------------------------------

function frictionSignals(all: Map<string, UserTrail>, exposed: UserTrail[]): FrictionSignals {
  const indecision = { one: 0, two: 0, threePlus: 0 };
  for (const t of exposed) {
    const distinct = new Set(t.selected.map((s) => s.methodId)).size;
    if (distinct === 1) indecision.one += 1;
    else if (distinct === 2) indecision.two += 1;
    else if (distinct >= 3) indecision.threePlus += 1;
  }

  const abandonedAt = { viewed: 0, selected: 0, copied: 0 };
  for (const t of exposed) if (t.lastLeft) abandonedAt[t.lastLeft.lastStep] += 1;

  const selectedNotDeposited = exposed.filter((t) => {
    if (t.selected.length === 0 || t.received.length === 0) return false;
    const lastSelected = [...t.selected].sort((a, b) => b.at - a.at)[0].methodId;
    const firstReceived = [...t.received].sort((a, b) => a.at - b.at)[0].methodId;
    return lastSelected !== firstReceived;
  }).length;

  return {
    indecision,
    loopers: exposed.filter((t) => t.views >= 2 && t.received.length === 0).length,
    abandonedAt,
    selectedNotDeposited,
    unexposedDepositors: [...all.values()].filter((t) => t.views === 0 && t.received.length > 0).length,
  };
}
