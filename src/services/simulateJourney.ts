import { randomUUID } from "node:crypto";
import { JOURNEYS, type Journey } from "@/content/journeys";
import { CONTROL_VARIANT, type Experiment, isEligible } from "@/domain/experiment";
import { eligibleMethodsFor, recommendedMethodFor } from "@/domain/recommendation";
import { type Clock, type Instant, formatInstant, hours, plus } from "@/domain/time";
import { type Db, queryRow, run } from "@/infra/db";
import { listAssignments } from "@/infra/repos/assignments";
import { listDeposits } from "@/infra/repos/deposits";
import { getExperiment } from "@/infra/repos/experiments";
import { listFundingMethods } from "@/infra/repos/fundingMethods";
import { type User, getUser, listUsers } from "@/infra/repos/users";
import { enrollUser } from "./enrollUser";
import { type IngestOutcome, ingestWebhook } from "./ingestWebhook";
import { type TrackOutcome, trackEvent } from "./trackEvent";
import { signBody } from "./webhookSignature";

/**
 * Simulated user journeys, for exercising /funnel and /results by hand.
 *
 * Nothing here bypasses the app: screen events go through `trackEvent` (the
 * same validation as /api/track) and deposits go through `ingestWebhook`
 * with a real HMAC signature (the same path as the provider). What differs
 * from live traffic is only that the data is tagged so it can be removed:
 * sessions start with "sim:", deposits and webhook ids with "dep_sim_" /
 * "evt_sim_". Deposit times are placed relative to the user's signup so the
 * activation rule sees them the way it would see real ones.
 */

export { JOURNEYS, JOURNEY_LABEL, type Journey } from "@/content/journeys";

export interface EmittedEvent {
  name: string;
  props: Record<string, unknown>;
  outcome: TrackOutcome["kind"];
}

export interface EmittedWebhook {
  type: string;
  depositId: string;
  occurredAt: string;
  outcome: IngestOutcome["kind"];
}

export interface JourneyReport {
  userId: string;
  variantShown: string;
  journey: Journey;
  methodId: string;
  events: EmittedEvent[];
  webhooks: EmittedWebhook[];
  skipped?: string;
}

export interface SimulationDeps {
  db: Db;
  clock: Clock;
  secret: string;
  experimentId?: string;
}

// ---- one user ---------------------------------------------------------------

export function simulateJourney(deps: SimulationDeps, userId: string, journey: Journey, rng: () => number = Math.random): JourneyReport {
  const { db } = deps;
  const user = getUser(db, userId);
  if (!user) throw new Error(`unknown user ${userId}`);
  const experiment = getExperiment(db, deps.experimentId ?? "funding_recommended_v1");
  if (!experiment) throw new Error("experiment not found — run npm run seed");

  const variantShown = enrollUser(db, deps.clock, user, experiment).variantShown;
  const methods = listFundingMethods(db);
  const eligible = eligibleMethodsFor(user.country, methods);
  const recommended = recommendedMethodFor(user.country, methods);
  const others = eligible.filter((m) => m.id !== recommended.id);
  const isB = variantShown !== CONTROL_VARIANT;

  // Which method the journey ends up on. B follows the recommendation unless
  // it deliberately expands; A picks anywhere in the list.
  const pick = <T,>(xs: T[]) => xs[Math.floor(rng() * xs.length)];
  const method = journey === "expanded" ? pick(others) : isB ? recommended : pick(eligible);

  // A single per-journey clock: every event lands a few seconds after the last.
  const ticker = steppingClock(deps.clock.now(), rng);
  const sessionId = `sim:${randomUUID().slice(0, 8)}`;
  const report: JourneyReport = { userId, variantShown, journey, methodId: method.id, events: [], webhooks: [] };

  const emit = (name: string, props: Record<string, unknown>) => {
    const outcome = trackEvent(
      { db, clock: ticker },
      {
        event_id: randomUUID(),
        name,
        user_id: userId,
        experiment_id: experiment.id,
        variant_shown: variantShown,
        session_id: sessionId,
        props,
      },
    );
    report.events.push({ name, props, outcome: outcome.kind });
  };

  const displayOrder = isB ? [recommended, ...others] : eligible;
  const viewed = () =>
    emit("funding_screen_viewed", {
      methods_shown: displayOrder.map((m) => m.id),
      recommended_method_id: isB ? recommended.id : null,
      n_visible: isB ? 1 : displayOrder.length,
      client_tz: "America/Argentina/Buenos_Aires",
    });
  const left = (lastStep: "viewed" | "selected" | "copied", msOnScreen: number) =>
    emit("funding_screen_left", { ms_on_screen: msOnScreen, last_step: lastStep });

  const msToSelect = 3_000 + Math.round(rng() * 25_000);
  const msToCopy = 4_000 + Math.round(rng() * 30_000);

  const select = (via: "list" | "primary" | "expanded", nBefore = 0) =>
    emit("funding_method_selected", {
      method_id: method.id,
      position: displayOrder.findIndex((m) => m.id === method.id),
      is_recommended: isB && method.id === recommended.id,
      via,
      ms_since_view: msToSelect,
      n_selected_before: nBefore,
    });
  const copy = () => emit("funding_details_copied", { method_id: method.id, field: "all", ms_since_select: msToCopy });

  switch (journey) {
    case "viewed":
      viewed();
      left("viewed", msToSelect);
      break;
    case "looper":
      viewed();
      left("viewed", msToSelect);
      viewed();
      left("viewed", msToSelect + 2_000);
      break;
    case "selected":
      viewed();
      select(isB ? "primary" : "list");
      left("selected", msToSelect + msToCopy);
      break;
    case "expanded": {
      viewed();
      emit("funding_options_expanded", { ms_since_view: Math.round(msToSelect / 2) });
      select("expanded");
      copy();
      left("copied", msToSelect + msToCopy + 1_000);
      deposit(deps, report, user, experiment, "completed", rng);
      break;
    }
    case "copied":
    case "deposited":
    case "late":
    case "failed":
      viewed();
      select(isB ? "primary" : "list");
      copy();
      left("copied", msToSelect + msToCopy + 1_000);
      if (journey !== "copied") deposit(deps, report, user, experiment, journey === "failed" ? "failed" : "completed", rng, journey === "late");
      break;
  }
  return report;
}

/** Two webhooks — received, then the final — timed relative to signup so the window rule applies as it would to real data. */
function deposit(
  deps: SimulationDeps,
  report: JourneyReport,
  user: User,
  experiment: Experiment,
  final: "completed" | "failed",
  rng: () => number,
  late = false,
) {
  const depositId = `dep_sim_${randomUUID().slice(0, 8)}`;
  const receivedAt = plus(user.createdAt, hours(late ? 170 + rng() * 40 : 12 + rng() * 90));
  const finalAt = plus(receivedAt, hours(2 + rng() * 36));
  const amount = Math.round((60 + rng() * 900) * 100) / 100;
  const currency = listFundingMethods(deps.db).find((m) => m.id === report.methodId)?.currency ?? "USD";

  for (const [type, at] of [["received", receivedAt], [final, finalAt]] as const) {
    const payload = {
      event_id: `evt_sim_${randomUUID().slice(0, 8)}`,
      type: `deposit.${type}`,
      occurred_at: formatInstant(at),
      data: { deposit_id: depositId, user_id: user.id, method_id: report.methodId, amount_usd: amount, currency, country: user.country },
    };
    const rawBody = Buffer.from(JSON.stringify(payload), "utf8");
    const outcome = ingestWebhook(
      { db: deps.db, clock: deps.clock, secret: deps.secret, verifySignature: true, experimentId: experiment.id },
      { rawBody, headers: { signature: signBody(deps.secret, rawBody), eventId: payload.event_id, eventType: payload.type } },
    );
    report.webhooks.push({ type: payload.type, depositId, occurredAt: payload.occurred_at, outcome: outcome.kind });
  }
}

// ---- many users -------------------------------------------------------------

export interface BatchOptions {
  users: number;
  seed: number;
  /** Skip users who already have deposits or simulated sessions, so effects are visible. */
  freshOnly?: boolean;
  /** Journey weights; defaults approximate a plausible funnel. */
  mix?: Partial<Record<Journey, number>>;
}

export const DEFAULT_MIX: Record<Journey, number> = {
  viewed: 25,
  looper: 5,
  selected: 15,
  copied: 15,
  deposited: 25,
  late: 5,
  failed: 5,
  expanded: 5,
};

export function simulateBatch(deps: SimulationDeps, options: BatchOptions): JourneyReport[] {
  const { db } = deps;
  const rng = mulberry32(options.seed);
  const experiment = getExperiment(db, deps.experimentId ?? "funding_recommended_v1");
  if (!experiment) throw new Error("experiment not found — run npm run seed");

  const enrolled = new Set(listAssignments(db, experiment.id).map((a) => a.userId));
  const withDeposits = new Set(listDeposits(db).map((d) => d.userId));
  let pool = listUsers(db).filter((u) => enrolled.has(u.id) && isEligible(experiment, u));
  if (options.freshOnly ?? true) pool = pool.filter((u) => !withDeposits.has(u.id) && !hasSimulatedSession(db, u.id));

  const mix = { ...DEFAULT_MIX, ...options.mix };
  const total = Object.values(mix).reduce((a, b) => a + b, 0);
  const pickJourney = (): Journey => {
    let r = rng() * total;
    for (const j of JOURNEYS) {
      r -= mix[j];
      if (r < 0) return j;
    }
    return "viewed";
  };

  const reports: JourneyReport[] = [];
  const shuffled = pool.toSorted(() => rng() - 0.5);
  for (const user of shuffled.slice(0, options.users)) {
    let journey = pickJourney();
    // "expanded" only makes sense on variant B; A users get a plain deposit instead.
    if (journey === "expanded" && enrollUser(db, deps.clock, user, experiment).variantShown === CONTROL_VARIANT) journey = "deposited";
    reports.push(simulateJourney(deps, user.id, journey, rng));
  }
  return reports;
}

// ---- bookkeeping ------------------------------------------------------------

export interface SimulatedCounts {
  sessions: number;
  clientEvents: number;
  deposits: number;
  webhooks: number;
}

export function simulatedCounts(db: Db): SimulatedCounts {
  return {
    sessions: queryRow<{ n: number }>(db, "SELECT COUNT(DISTINCT session_id) AS n FROM events WHERE session_id LIKE 'sim:%'").n,
    clientEvents: queryRow<{ n: number }>(db, "SELECT COUNT(*) AS n FROM events WHERE session_id LIKE 'sim:%'").n,
    deposits: queryRow<{ n: number }>(db, "SELECT COUNT(*) AS n FROM deposits WHERE id LIKE 'dep_sim_%'").n,
    webhooks: queryRow<{ n: number }>(db, "SELECT COUNT(*) AS n FROM webhook_inbox WHERE deposit_id LIKE 'dep_sim_%'").n,
  };
}

/** Removes everything the simulator wrote. Assignments are never touched. */
export function deleteSimulatedData(db: Db): SimulatedCounts {
  const before = simulatedCounts(db);
  db.exec("BEGIN IMMEDIATE");
  try {
    run(db, "DELETE FROM events WHERE session_id LIKE 'sim:%' OR event_id LIKE 'dep:dep_sim_%'");
    run(db, "DELETE FROM webhook_inbox WHERE deposit_id LIKE 'dep_sim_%'");
    run(db, "DELETE FROM deposits WHERE id LIKE 'dep_sim_%'");
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return before;
}

function hasSimulatedSession(db: Db, userId: string): boolean {
  return queryRow<{ n: number }>(db, "SELECT COUNT(*) AS n FROM events WHERE user_id = ? AND session_id LIKE 'sim:%'", userId).n > 0;
}

// ---- helpers ------------------------------------------------------------------

/** Advances 1–6 s per call so consecutive events are strictly ordered. */
function steppingClock(start: Instant, rng: () => number): Clock {
  let t = start;
  return {
    now: () => {
      t = (t + 1_000 + Math.round(rng() * 5_000)) as Instant;
      return t;
    },
  };
}

/** Small seeded PRNG so a batch is reproducible from its seed. */
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
