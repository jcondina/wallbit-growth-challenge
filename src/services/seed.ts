import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { variantFor } from "@/domain/assignment";
import { SCHEMA_VERSION, assignmentEventId } from "@/domain/events";
import { type Experiment, FUNDING_EXPERIMENT, isEligible } from "@/domain/experiment";
import { type Clock, parseInstant, systemClock } from "@/domain/time";
import { type Db, tx } from "@/infra/db";
import { countAssignmentsByVariant, insertAssignmentIfMissing } from "@/infra/repos/assignments";
import { countDepositsByStatus, insertDepositIfMissing } from "@/infra/repos/deposits";
import { countEventsByName, insertEventIfMissing } from "@/infra/repos/events";
import { getExperiment, insertExperimentIfMissing } from "@/infra/repos/experiments";
import { countFundingMethods, upsertFundingMethods } from "@/infra/repos/fundingMethods";
import { countUsers, listUsers, upsertUsers } from "@/infra/repos/users";

/**
 * Loads the challenge fixtures and enrolls eligible users.
 *
 * Idempotent by construction: users and methods are upserted, everything
 * else is insert-if-missing. Running it twice reports "+0" everywhere.
 * Webhook data is never touched; only `scripts/reset.ts` deletes the file.
 *
 * Enrollment happens here, at signup time (assigned_at = created_at), which
 * is the intent-to-treat decision: every eligible user is in the experiment
 * whether or not the simulated month ever shows them the screen.
 */

// Fixture shapes — strict, and timestamps go through parseInstant so a naive
// or malformed date in a data file crashes the seed instead of loading.
const UserFixture = z
  .object({
    id: z.string().min(1),
    email: z.string().min(1),
    country: z.string().length(2),
    created_at: z.string().transform(parseInstant),
    kyc_status: z.enum(["approved", "pending", "rejected"]),
  })
  .strict();

const MethodFixture = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    kind: z.enum(["local_transfer", "bank_transfer", "crypto", "third_party"]),
    currency: z.string().min(1),
    countries: z.array(z.string().min(1)).min(1),
    settlement_hours: z.number().int().nonnegative(),
    fee_pct: z.number().nonnegative(),
  })
  .strict();

const HistoricalDepositFixture = z
  .object({
    id: z.string().min(1),
    user_id: z.string().min(1),
    method_id: z.string().min(1),
    amount_usd: z.number().positive(),
    status: z.literal("completed"),
    created_at: z.string().transform(parseInstant),
    completed_at: z.string().transform(parseInstant),
  })
  .strict();

export interface SeedReport {
  users: { total: number; added: number };
  methods: { total: number; added: number };
  historicalDeposits: { total: number; added: number };
  experiment: { id: string; created: boolean };
  assignments: { byVariant: Record<string, number>; added: number; ineligible: number };
  events: { total: number; added: number };
}

export interface SeedOptions {
  dataDir?: string;
  experiment?: Experiment;
  clock?: Clock;
}

function loadJson<T>(dataDir: string, file: string, schema: z.ZodType<T>): T[] {
  const raw = JSON.parse(readFileSync(path.join(dataDir, file), "utf8")) as unknown;
  return z.array(schema).parse(raw);
}

export function seedDatabase(db: Db, options: SeedOptions = {}): SeedReport {
  const dataDir = options.dataDir ?? path.join(process.cwd(), "data");
  const experiment = options.experiment ?? FUNDING_EXPERIMENT;
  const clock = options.clock ?? systemClock;

  const users = loadJson(dataDir, "users.json", UserFixture);
  const methods = loadJson(dataDir, "funding_methods.json", MethodFixture);
  const deposits = loadJson(dataDir, "deposits_historicos.json", HistoricalDepositFixture);

  return tx(db, () => {
    const usersBefore = countUsers(db);
    upsertUsers(
      db,
      users.map((u) => ({
        id: u.id,
        email: u.email,
        country: u.country,
        createdAt: u.created_at,
        kycStatus: u.kyc_status,
      })),
    );

    const methodsBefore = countFundingMethods(db);
    upsertFundingMethods(
      db,
      methods.map((m) => ({
        id: m.id,
        name: m.name,
        kind: m.kind,
        currency: m.currency,
        countries: m.countries,
        settlementHours: m.settlement_hours,
        feePct: m.fee_pct,
      })),
    );

    const now = clock.now();
    const userById = new Map(users.map((u) => [u.id, u]));
    let depositsAdded = 0;
    for (const d of deposits) {
      const user = userById.get(d.user_id);
      const inserted = insertDepositIfMissing(db, {
        id: d.id,
        userId: d.user_id,
        methodId: d.method_id,
        amountUsd: d.amount_usd,
        currency: null,
        country: user?.country ?? null,
        status: "completed",
        initiatedAt: d.created_at,
        completedAt: d.completed_at,
        failedAt: null,
        source: "historical",
        userKnown: user !== undefined,
        updatedAt: now,
      });
      if (inserted) depositsAdded += 1;
    }

    const experimentCreated = insertExperimentIfMissing(db, experiment);
    // Enroll against the stored row: a paused/changed experiment must not be
    // silently replaced by the constant on reseed.
    const stored = getExperiment(db, experiment.id);
    if (!stored) throw new Error(`experiment ${experiment.id} missing after insert`);

    let assignmentsAdded = 0;
    let eventsAdded = 0;
    let ineligible = 0;
    for (const user of listUsers(db)) {
      if (!isEligible(stored, user)) {
        ineligible += 1;
        continue;
      }
      const variant = variantFor(stored, user.id);
      const inserted = insertAssignmentIfMissing(db, {
        experimentId: stored.id,
        userId: user.id,
        variant,
        allocationVersion: stored.allocationVersion,
        assignedAt: user.createdAt,
      });
      if (inserted) assignmentsAdded += 1;

      const eventInserted = insertEventIfMissing(db, {
        eventId: assignmentEventId(stored.id, user.id),
        name: "experiment_assigned",
        userId: user.id,
        occurredAt: user.createdAt,
        recordedAt: now,
        source: "system",
        experimentId: stored.id,
        variantShown: null,
        country: user.country,
        sessionId: null,
        schemaVersion: SCHEMA_VERSION,
        props: { variant, allocation_version: stored.allocationVersion },
      });
      if (eventInserted) eventsAdded += 1;
    }

    const historical = countDepositsByStatus(db, "historical");
    const eventCounts = countEventsByName(db);
    return {
      users: { total: countUsers(db), added: countUsers(db) - usersBefore },
      methods: { total: countFundingMethods(db), added: countFundingMethods(db) - methodsBefore },
      historicalDeposits: {
        total: historical.completed + historical.received + historical.failed + historical.conflict,
        added: depositsAdded,
      },
      experiment: { id: stored.id, created: experimentCreated },
      assignments: {
        byVariant: countAssignmentsByVariant(db, stored.id),
        added: assignmentsAdded,
        ineligible,
      },
      events: {
        total: Object.values(eventCounts).reduce((a, b) => a + b, 0),
        added: eventsAdded,
      },
    };
  });
}
