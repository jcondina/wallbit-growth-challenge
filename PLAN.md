# PLAN — Wallbit Growth Challenge (A/B funding screen)

Internal working plan. Written in English (code language); the deliverables the
evaluators read — `README.md`, `ENTREGA.md`, UI copy — are in Spanish.
The original brief is preserved verbatim in [`CHALLENGE.md`](CHALLENGE.md).

Every decision below was taken deliberately and is defended in `ENTREGA.md`.
When implementation and this plan disagree, update the plan in the same commit.

---

## 0. What the challenge is really testing

The brief reads as "build an A/B test". The dataset is built as a correctness
exam on three things: **asynchronous, at-least-once webhooks**, **time**, and
**cohort definition**. Verified facts about the material (all numbers come from
scripts run against `data/*.json` and `simulator/scenario.json`):

| Trap in the data | Numbers | Breaks if missed |
|---|---|---|
| Duplicate `event_id` (immediate retries, gap 1–2 in stream) | 648 deliveries → 606 unique | inbox counts lie; conversions double if read from events |
| Same `deposit_id`+`type` under a *new* `event_id` (resends) | 8 | dedupe on `event_id` alone is insufficient |
| Out-of-order delivery | 36 `occurred_at` inversions; 1 deposit gets `completed` before `received` | state machines that require `received` first drop a conversion |
| **First event in the whole stream is `deposit.failed`** for `dep_100030`, never seen before | event #1 | "received → final" reducers 500 on request #1 |
| Failed deposits | 45 failed; 31 users with *only* failures; 14 users with a failure **and** a completion | counting `received` as conversion |
| 7-day window | 254 users complete a deposit; only **210** within 168h; 44 late (8–20 days) | reporting ~42% instead of 35% |
| Pre-experiment users | 600 of 1200 signed up before 2026-08-01; none appear in the scenario | denominator 1200 |
| Cutoff timezone | 5 users signed up between 00:00Z and 03:00Z on Aug 1 | 600 vs 595 eligible depending on "midnight where?" |
| Countries without a local method | `UY`, `ES` | variant B has nothing to recommend |
| Simulator run twice | must produce identical numbers | idempotency must hold at deposit level, not just inbox |
| Simulator never retries | timeout 10s, cold Next.js compile can exceed it | first event silently lost in that run |

Ground truth for the experiment cohort: **210 / 600 eligible users activate = 35.0%**.

The simulator is **variant-blind**: it emits the same deposits regardless of
what the app shows. Any A/B difference is sampling noise from the split. With
the hash specified in §5 the split is **A 113/296 = 38.2%, B 97/304 = 31.9%,
p ≈ 0.11**. The correct reading is "no detectable effect", and the dashboard
is designed so that this is the only reading a Growth reader can reach.

Additional payload facts (so we do not over-engineer): no payload drift between
events of one deposit; resends carry identical `occurred_at`; no unknown users
or methods; all amounts positive; currency always matches the method; every
timestamp in the material is strict `YYYY-MM-DDTHH:MM:SSZ`.

---

## 1. Decisions log

Grouped, with the one-line rationale. Details in the relevant section.

### Product / metric
- **Activation** = first `deposit.completed` whose provider `occurred_at` is
  `<= users.created_at + 168h` (inclusive). `received` never counts; `failed`
  never counts; late completions count as deposits, not activations.
- **Eligibility** = `created_at >= 2026-08-01T00:00:00Z` (UTC midnight, not
  ART). Pre-experiment users are not "new users"; they see control (A) and are
  never enrolled. Experiment end bounds enrollment, not a user's window.
- **KYC**: everyone counts. The brief puts KYC out of scope and the provider
  evidently credited deposits for `rejected` users (4 of 210 activations).
- **Denominator** = enrolled users, enrolled at signup (intent-to-treat). The
  simulator produces no screen views, so "exposed" is unobservable for August.
  Exposure is tracked separately so the exposed cut exists for real traffic.
- **Variant B recommendation** = local transfer for the country → `sepa_eu` if
  the country is in it (ES) → `wire_us` (UY). "Local, always" is the brief's
  hypothesis verbatim; the PE/BO/GT/DO settlement caveat (36–48h) is noted.
- **Baseline** (pre-experiment cohort, same read model): credited ≤168h
  **23.0%** (138/600); initiated ≤168h 27.2%; ever converted 33.5% ("un
  tercio"). Baseline is *context and calibration*, never the comparison group:
  control A (38.2%) is itself far above baseline (z = 4.8) — the dataset's own
  argument for A/B over before/after.
- **No pre-registered target lift.** Report MDE (~10pp at ~300/arm) and the
  sample-size table; Growth sets the bar.
- **Conflict** (`completed` and `failed` for one deposit): `status = conflict`,
  not counted, surfaced on the data-quality panel. Conservative on purpose.

### Engineering
- Next.js 16 (App Router, TS, `src/`), Tailwind v4, `node:sqlite`, `zod`,
  `vitest`, `tsx` for scripts. npm. Node 24 (`.nvmrc`), `engines >= 22.18`.
- Next 16 conventions (from the bundled docs): `params`/`searchParams` are
  promises; GET route handlers are dynamic by default; pages that read the DB
  call `await connection()` first so `next build` never prerenders a snapshot
  (`export const dynamic` is gone under Cache Components). Turbopack default.
- `node:sqlite` over `better-sqlite3`: zero native build, zero install risk
  for whoever clones (verified on Node 24: no warning, `CHECK`, generated
  columns, WAL all work). Transactions via `BEGIN IMMEDIATE` / `COMMIT`.
- **Time**: business logic only handles instants. `domain/time.ts` is the only
  file allowed to touch `Date`. Instants are branded epoch-ms integers; columns
  are `INTEGER` with `CHECK(typeof(x)='integer')` plus a virtual ISO column for
  humans. No SQLite date functions in queries. Tests run under four TZs.
- **Assignment**: `sha256("{experimentId}:{userId}")`, first 8 hex → uint32
  `% 100` → bucket; cumulative allocation weights pick the variant. Persisted in
  `assignments` with `allocation_version`; the table is the source of truth,
  the hash is consulted only on first enrollment.
- **Webhook**: raw-body HMAC (`timingSafeEqual`), zod, `INSERT OR IGNORE` into
  inbox, pure reducer, upsert, domain event — all in one transaction. `200` for
  every well-formed event (including duplicates and unknown users); `400`
  malformed; `401` bad signature; `500` on storage failure so the provider
  retries.
- **Events**: one append-only `events` table, strict zod schema per event
  name, client clocks never used as timestamps, `INSERT OR IGNORE` by
  `event_id`. `deposits` remains the source of truth for the metric; events are
  for funnel shape.
- **Read models**: `experimentResults(cohort)` with `cohort ∈ {experiment,
  baseline}` — one activation rule, two inputs; `funnelResults()` over events.
- **Kill switch**: `experiments.status` in DB + `/admin` toggle. Paused ⇒
  everyone sees A, no new enrollments, existing assignments untouched, results
  banner. Unauthenticated (stated).
- **Extras pulled in from the "won't fit" list**: z-test + CIs, HMAC, cut by
  country, kill switch. Each is small and finished; the scope narrative in
  ENTREGA states the priority order as if the 4h cap existed.
- **Verification**: `scripts/verify.py` recomputes everything from raw JSON in
  Python (no shared code with the app) and diffs against `/api/results`.

### Delivery
- Language: ES for README/ENTREGA/UI strings; EN for code, comments, tests,
  commits, this plan.
- `data/` and `simulator/` are never modified (evaluators can diff against
  what they sent). Original README kept as `CHALLENGE.md`.
- Git: one commit per phase, messages narrate the build.
- No time cap on phases; `ENTREGA.md` reports honest hours including planning.

---

## 2. Architecture

### 2.1 Layers and the dependency rule

```
app (Next.js routes, pages, components)
  └─▶ services (use cases; one transaction each)
        ├─▶ domain (pure TS: rules, reducers, stats; NO framework, NO db, NO Date)
        └─▶ infra  (node:sqlite, schema, thin repositories)
```

Arrows only point downward. `domain/` imports nothing from Next, SQLite, or
`Date` (except `domain/time.ts`). This is what makes the rules unit-testable
under any timezone and what you can extend live without touching I/O.

### 2.2 Directory layout

```
.
├── CHALLENGE.md                  original brief, verbatim
├── README.md                     cómo se corre (ES)
├── ENTREGA.md                    decisiones (ES)
├── PLAN.md                       this file
├── data/                         given — untouched
├── simulator/                    given — untouched
├── scripts/
│   ├── seed.ts                   data/*.json → tables; enroll eligible users
│   ├── reset.ts                  delete var/wallbit.db
│   ├── replay.sh                 warm-up GET /api/health, then simulator --stop-on-error
│   └── verify.py                 independent recomputation; diff vs /api/results
├── src/
│   ├── domain/
│   │   ├── time.ts               Instant, Duration, parseInstant, formatInstant, hours, elapsed, isWithin, Clock
│   │   ├── experiment.ts         Experiment type, isEligible, isRunning, activationWindow
│   │   ├── fundingMethod.ts      FundingMethod type, isAvailableIn
│   │   ├── provider.ts           zod contract for the raw webhook payload → DepositEvent
│   │   ├── assignment.ts         hashBucket, variantFor(experiment, userId)
│   │   ├── recommendation.ts     eligibleMethodsFor, recommendedMethodFor
│   │   ├── deposit.ts            Deposit state + applyDepositEvent (pure reducer), statusOf
│   │   ├── activation.ts         isActivated, firstCompletedAt, summarizeActivation
│   │   ├── events.ts             event catalogue: names, envelope, zod schemas
│   │   ├── stats.ts              wilsonCI, twoProportionZTest, diffCI, mde, requiredPerArm, pBBeatsA
│   │   ├── verdict.ts            verdict state machine (Spanish templates live in content/verdict.ts)
│   │   └── funnel.ts             pure funnel computation over event rows
│   ├── infra/
│   │   ├── config.ts             env → typed config, every value defaulted
│   │   ├── db.ts                 DatabaseSync singleton (globalThis-cached), schema bootstrap, tx helper
│   │   ├── schema.sql
│   │   └── repos/
│   │       ├── users.ts
│   │       ├── fundingMethods.ts
│   │       ├── experiments.ts
│   │       ├── assignments.ts
│   │       ├── webhookInbox.ts
│   │       ├── deposits.ts
│   │       └── events.ts
│   ├── services/
│   │   ├── seed.ts               fixtures → tables + enrollment (CLI in scripts/seed.ts)
│   │   ├── enrollUser.ts         getOrCreateAssignment (eligibility-gated, status-gated)
│   │   ├── ingestWebhook.ts      verify → parse → inbox → reduce → upsert → emit
│   │   ├── webhookSignature.ts   HMAC-SHA256 over raw bytes, constant-time compare
│   │   ├── trackEvent.ts         validate against catalogue, stamp, store
│   │   ├── experimentResults.ts  read model (cohort = experiment | baseline)
│   │   ├── funnelResults.ts      read model over events
│   │   └── experimentControl.ts  pause / resume
│   ├── app/
│   │   ├── layout.tsx            <html lang="es">, fonts, color-scheme meta
│   │   ├── globals.css           tokens (@theme), dark mode, base styles
│   │   ├── page.tsx              dev index: sample users, links
│   │   ├── u/[userId]/fund/page.tsx
│   │   ├── results/page.tsx
│   │   ├── funnel/page.tsx
│   │   ├── admin/page.tsx
│   │   ├── webhooks/deposits/route.ts          POST — simulator default path
│   │   └── api/
│   │       ├── health/route.ts                 GET
│   │       ├── track/route.ts                  POST
│   │       ├── results/route.ts                GET
│   │       ├── funnel/route.ts                 GET
│   │       └── admin/experiments/[id]/status/route.ts   POST
│   ├── components/
│   │   ├── ui/                   Page, Section, Card, Stat, DataTable, Pill, Callout, Disclosure, Button, CIBar
│   │   ├── funding/              FundingScreen (client), MethodCard, MethodList, InstructionsPanel, Ribbon
│   │   └── results/              Verdict, PrimaryTable, BaselineCard, MechanismTable, GuardrailsTable, CountryTable, DataQuality, Power
│   ├── lib/
│   │   ├── analytics.ts          client track(): envelope, session id, sendBeacon
│   │   └── format.ts             es-AR number/percent/date formatting (the only place Instant meets a locale)
│   └── content/
│       ├── fundingInstructions.ts  method → fake sandbox fields to copy
│       ├── verdict.ts              Spanish verdict sentence + tone
│       └── copy.ts                 Spanish UI strings, metric definition, caveats
├── tests/
│   ├── domain/                   time, assignment, recommendation, deposit, activation, stats, verdict, funnel, events
│   ├── services/                 ingestWebhook (in-memory db), trackEvent
│   ├── replay.test.ts            whole scenario through the reducer in-process → 210/600 and split
│   └── architecture.test.ts      greps src/domain for Date usage outside time.ts
├── var/                          sqlite file (gitignored)
├── .env.example  .nvmrc  next.config.ts  vitest.config.mts  tsconfig.json  package.json
```

### 2.3 Data model (`src/infra/schema.sql`)

Every `*_at` column is epoch **milliseconds**, `INTEGER`, with a `typeof`
check, and a virtual `*_at_iso` twin for browsing. No `DEFAULT
CURRENT_TIMESTAMP` anywhere; the app writes every timestamp.

```sql
CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,
  email       TEXT NOT NULL,
  country     TEXT NOT NULL,
  created_at  INTEGER NOT NULL CHECK (typeof(created_at) = 'integer'),
  kyc_status  TEXT NOT NULL CHECK (kyc_status IN ('approved','pending','rejected')),
  created_at_iso TEXT GENERATED ALWAYS AS
    (strftime('%Y-%m-%dT%H:%M:%fZ', created_at / 1000.0, 'unixepoch')) VIRTUAL
);

CREATE TABLE IF NOT EXISTS funding_methods (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  kind             TEXT NOT NULL,          -- local_transfer | bank_transfer | crypto | third_party
  currency         TEXT NOT NULL,
  countries        TEXT NOT NULL,          -- JSON array; "*" = everywhere. Evaluated in TS.
  settlement_hours INTEGER NOT NULL,
  fee_pct          REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS experiments (
  id                 TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  starts_at          INTEGER NOT NULL CHECK (typeof(starts_at) = 'integer'),
  ends_at            INTEGER,              -- NULL = open
  window_hours       INTEGER NOT NULL,     -- 168
  status             TEXT NOT NULL CHECK (status IN ('running','paused','finished')),
  paused_at          INTEGER,
  allocation         TEXT NOT NULL,        -- JSON [{"variant":"A","weight":50},{"variant":"B","weight":50}]
  allocation_version INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS assignments (
  experiment_id      TEXT NOT NULL,
  user_id            TEXT NOT NULL,
  variant            TEXT NOT NULL,
  allocation_version INTEGER NOT NULL,
  assigned_at        INTEGER NOT NULL CHECK (typeof(assigned_at) = 'integer'),
  PRIMARY KEY (experiment_id, user_id)
);

CREATE TABLE IF NOT EXISTS webhook_inbox (
  event_id        TEXT PRIMARY KEY,        -- dedupe layer 1
  event_type      TEXT NOT NULL,
  deposit_id      TEXT NOT NULL,
  occurred_at     INTEGER NOT NULL CHECK (typeof(occurred_at) = 'integer'),
  received_at     INTEGER NOT NULL CHECK (typeof(received_at) = 'integer'),
  signature_ok    INTEGER NOT NULL,        -- 0/1
  header_mismatch INTEGER NOT NULL DEFAULT 0,
  anomalies       TEXT,                    -- JSON array of strings, NULL if none
  payload         TEXT NOT NULL,           -- raw body
  occurred_at_iso TEXT GENERATED ALWAYS AS
    (strftime('%Y-%m-%dT%H:%M:%fZ', occurred_at / 1000.0, 'unixepoch')) VIRTUAL
);

CREATE TABLE IF NOT EXISTS deposits (
  id            TEXT PRIMARY KEY,          -- deposit_id; dedupe layer 2 via reducer
  user_id       TEXT NOT NULL,             -- no FK on purpose: unknown users are stored and flagged
  method_id     TEXT NOT NULL,
  amount_usd    REAL NOT NULL,
  currency      TEXT,
  country       TEXT,
  status        TEXT NOT NULL CHECK (status IN ('received','completed','failed','conflict')),
  initiated_at  INTEGER,                   -- webhook: min(received.occurred_at); historical: created_at
  completed_at  INTEGER,                   -- min(completed.occurred_at)
  failed_at     INTEGER,                   -- min(failed.occurred_at)
  source        TEXT NOT NULL CHECK (source IN ('webhook','historical')),
  user_known    INTEGER NOT NULL DEFAULT 1,
  updated_at    INTEGER NOT NULL,
  completed_at_iso TEXT GENERATED ALWAYS AS
    (strftime('%Y-%m-%dT%H:%M:%fZ', completed_at / 1000.0, 'unixepoch')) VIRTUAL
);
CREATE INDEX IF NOT EXISTS deposits_user ON deposits (user_id);

CREATE TABLE IF NOT EXISTS events (
  event_id       TEXT PRIMARY KEY,         -- uuid (client) | "dep:{id}:{type}" (webhook) | "assign:{exp}:{user}" (system)
  name           TEXT NOT NULL,
  user_id        TEXT NOT NULL,
  occurred_at    INTEGER NOT NULL CHECK (typeof(occurred_at) = 'integer'),
  recorded_at    INTEGER NOT NULL CHECK (typeof(recorded_at) = 'integer'),
  source         TEXT NOT NULL CHECK (source IN ('client','webhook','system')),
  experiment_id  TEXT,
  variant_shown  TEXT,                     -- what was rendered, not what the table says
  country        TEXT,
  session_id     TEXT,
  schema_version INTEGER NOT NULL DEFAULT 1,
  props          TEXT NOT NULL,            -- JSON, validated by the catalogue
  occurred_at_iso TEXT GENERATED ALWAYS AS
    (strftime('%Y-%m-%dT%H:%M:%fZ', occurred_at / 1000.0, 'unixepoch')) VIRTUAL
);
CREATE INDEX IF NOT EXISTS events_user_name ON events (user_id, name);
CREATE INDEX IF NOT EXISTS events_name_time ON events (name, occurred_at);
```

`db.ts`: opens `var/wallbit.db` (path from `DB_PATH`, resolved from
`process.cwd()`), `PRAGMA journal_mode = WAL`, `PRAGMA busy_timeout = 5000`,
`PRAGMA foreign_keys = ON`, runs `schema.sql` (all `IF NOT EXISTS`), caches
the handle on `globalThis` so HMR does not reopen it. Exposes
`tx(fn)` = `BEGIN IMMEDIATE` / `COMMIT` / `ROLLBACK`.

---

## 3. Time model (`src/domain/time.ts`)

Principle: **business logic only handles instants**. Civil time (dates, hours,
"days", zones, DST) exists only at the presentation edge. Users' local time
never enters the system; every input is an instant (signup, provider
`occurred_at`); every rule is a duration between instants.

```ts
export type Instant  = number & { readonly __brand: 'Instant' };   // epoch ms
export type Duration = number & { readonly __brand: 'Duration' };  // ms

export class InvalidInstant extends Error {}

const STRICT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/;

export function parseInstant(raw: unknown): Instant;   // Z or explicit offset only; naive → throws
export function formatInstant(i: Instant): string;     // always 'YYYY-MM-DDTHH:MM:SS.sssZ'
export function instant(ms: number): Instant;          // for tests / clock
export const hours  = (n: number): Duration => (n * 3_600_000) as Duration;
export const days   = (n: number): Duration => hours(24 * n);
export const elapsed = (from: Instant, to: Instant): Duration => (to - from) as Duration;
export const plus    = (i: Instant, d: Duration): Instant => (i + d) as Instant;
export const isWithin = (from: Instant, to: Instant, max: Duration) => to >= from && elapsed(from, to) <= max;
export interface Clock { now(): Instant }
export const systemClock: Clock = { now: () => Date.now() as Instant };
```

Rules:
1. `parseInstant` is the only door in. Webhook with a bad timestamp → `400`.
   Seed with a bad timestamp → crash.
2. `Date` is banned outside `time.ts` and `lib/format.ts` (presentation).
   `tests/architecture.test.ts` greps for `new Date(`, `Date.now(`,
   `toLocale`, `getHours`, `getDate(` in `src/domain` and fails if found.
3. `Clock` is injected into services and used only for metadata
   (`received_at`, `recorded_at`, `assigned_at`) and anomaly detection —
   never inside a business rule.
4. Presentation formats with `Intl.DateTimeFormat('es-AR', { timeZone: 'UTC',
   ... })` and appends "UTC". Never the default time zone.
5. `TZ=UTC` is set in `dev`/`start` scripts as belt-and-braces; the design
   must not depend on it, which `npm run test:tz` proves.

Civil-time decisions, written once: experiment start `2026-08-01T00:00:00Z`;
window = `hours(168)` inclusive; conversion instant = `occurred_at` of
`deposit.completed`; resends with different `occurred_at` keep the earliest.

---

## 4. Experiment definition (`src/domain/experiment.ts`)

```ts
export type Variant = string;                          // 'A' | 'B' today; not hardcoded
export interface Allocation { variant: Variant; weight: number }   // weights sum to 100
export interface Experiment {
  id: string; name: string;
  startsAt: Instant; endsAt: Instant | null;
  windowHours: number;
  status: 'running' | 'paused' | 'finished'; pausedAt: Instant | null;
  allocation: Allocation[]; allocationVersion: number;
}
export const FUNDING_EXPERIMENT: Experiment = { id: 'funding_recommended_v1', ..., allocation: [{A,50},{B,50}] };
export function isEligible(exp, user): boolean;        // createdAt >= startsAt && (endsAt == null || createdAt < endsAt)
export function isRunning(exp): boolean;
export function windowFor(exp): Duration;              // hours(exp.windowHours)
export const CONTROL: Variant = 'A';
```

Seeded into the `experiments` table from the constant; services read the row
(so `/admin` can pause without a deploy). Variant → screen mapping lives only
in `components/funding/FundingScreen.tsx`.

---

## 5. Assignment (`src/domain/assignment.ts`, `services/enrollUser.ts`)

```ts
export function hashBucket(experimentId: string, userId: string): number {
  // sha256 hex of `${experimentId}:${userId}`, first 8 hex chars → uint32 → % 100
}
export function variantFor(exp: Experiment, userId: string): Variant {
  // walk allocation cumulatively; first entry whose cumulative weight > bucket
}
```

With `[A:50, B:50]`: bucket `< 50` → A. `scripts/verify.py` replicates this
exactly (`int(sha256(...).hexdigest()[:8], 16) % 100 < 50`).

`enrollUser(userId, exp, clock)`:
1. Load user; if `!isEligible` → return `{ variant: CONTROL, enrolled: false, reason: 'ineligible' }`.
2. If assignment exists → return it (source of truth; never recompute).
3. If `!isRunning` → return `{ variant: CONTROL, enrolled: false, reason: 'paused' }`.
4. `INSERT OR IGNORE` assignment with `variantFor`, `allocation_version`, `assigned_at = clock.now()`; read back; emit `experiment_assigned` (`event_id = assign:{exp}:{user}`).

Properties: deterministic (concurrent first visits compute the same variant),
sticky (table wins over hash), version-aware (allocation changes never
reshuffle existing users), eligibility-gated (demo clicks on pre-experiment
users cannot inflate the denominator). `seed.ts` enrolls all eligible users
at signup time (`assigned_at = created_at`), which is the ITT decision.

---

## 6. Recommendation (`src/domain/recommendation.ts`)

```ts
export function eligibleMethodsFor(country, methods): FundingMethod[];   // countries includes '*' or country
export function recommendedMethodFor(country, methods): FundingMethod;   // local_transfer for country → sepa_eu if listed → wire_us
```

Property test: for every country in `users.json`, the recommendation exists in
the catalogue and is eligible for that country; B's "otras opciones" never
contains the recommended method.

---

## 7. Webhook ingestion

### 7.1 Route `POST /webhooks/deposits` → `services/ingestWebhook.ts`

```
1. raw = Buffer.from(await req.arrayBuffer())               never req.json() first
2. signature: header 'X-Wallbit-Signature' = 'sha256=<hex>'
     - if WEBHOOK_VERIFY_SIGNATURE !== 'false': compute HMAC-SHA256(secret, raw);
       length check, then crypto.timingSafeEqual; missing/bad → 401
3. body = JSON.parse(raw) → zod WebhookEvent (event_id, type ∈ 3, occurred_at via parseInstant,
   data{deposit_id, user_id, method_id, amount_usd>0?, currency, country}) → 400 on failure
   header X-Wallbit-Event-Id ≠ body.event_id → header_mismatch = 1 (body wins; it is what was signed)
4. tx:
   a. INSERT OR IGNORE webhook_inbox(event_id, …, payload)  → changes == 0 ⇒ COMMIT, 200 {status:'duplicate'}
   b. current = deposits.get(deposit_id) ?? null
   c. next = applyWebhookEvent(current, event)               pure, §7.2
   d. if next !== current: deposits.upsert(next)
   e. for each transition in next.transitions: events.insertOrIgnore(dep:{id}:{type}, name = deposit_{type}, occurred_at = event.occurred_at, source='webhook', user_id, experiment/variant from assignment if any)
   f. anomalies (user unknown, deposit before signup, occurred_at > now + 5min, method unknown) → inbox.anomalies; never reject
5. 200 {status:'processed'|'noop'}.  Any thrown error after step 3 → 500 (provider retries).
```

Latency budget: the simulator times out at 10s and never retries. SQLite sync
writes take milliseconds; the only risk is a cold compile, handled by
`scripts/replay.sh` warm-up.

### 7.2 Reducer (`src/domain/deposit.ts`)

```ts
export interface DepositState {
  id, userId, methodId, amountUsd, currency, country,
  status: 'received'|'completed'|'failed'|'conflict',
  initiatedAt: Instant|null, completedAt: Instant|null, failedAt: Instant|null
}
export interface ReduceResult { state: DepositState; changed: boolean; transitions: ('received'|'completed'|'failed')[] }
export function applyWebhookEvent(current: DepositState|null, ev: WebhookEvent): ReduceResult
```

Semantics:
- Creation from **any** event type (the first event in the stream is a `failed`).
- Each type sets its own timestamp: `x_at = min(existing, occurred_at)`.
  Setting a previously-null timestamp is a *transition* (emits a domain event
  exactly once per `(deposit, type)` — that is how resends become no-ops).
- Status precedence: `completed`/`failed` > `received`. A late `received`
  fills `initiatedAt` and never regresses status.
- `completed` and `failed` both present → `conflict`.
- Payload fields: `userId`/`methodId` frozen on first sight (mismatch → anomaly),
  `amountUsd` takes the final event's value.
- Pure and deterministic: every permutation of a deposit's events (with
  duplicates) yields the same final state. That is the property test.

### 7.3 What the August replay must produce (acceptance)

inbox 606 rows (648 deliveries, 42 duplicate responses) · 8 resends detected as
no-ops · deposits 299 (254 completed, 45 failed, 0 conflict) · 0 anomalies ·
0 unknown users · last `occurred_at` 2026-08-30T15:27:00Z · **second replay
changes nothing but the delivery counter.**

---

## 8. Event catalogue (`src/domain/events.ts`) and tracking

### 8.1 Flow

```
S0 registro                    system   users.created_at
S1 funding_screen_viewed       client   exposure (first one) + looping (repeats)
S2 funding_method_selected     client   A: list · B: primary or expanded list
S2' funding_options_expanded   client   B only — recommendation rejected
S3 funding_details_copied      client   strongest in-app intent
S4 funding_screen_left         client   best-effort (pagehide + sendBeacon)
── outside the app ──
S5 deposit_received            webhook
S6 deposit_completed | deposit_failed   webhook
+  experiment_assigned         system
```

### 8.2 Envelope (all events)

`event_id`, `name`, `user_id`, `occurred_at`, `recorded_at`, `source`,
`experiment_id`, `variant_shown`, `country`, `session_id`, `schema_version`.

### 8.3 Per-event props (strict zod; unknown props rejected)

| Event | Props |
|---|---|
| `experiment_assigned` | `variant`, `allocation_version` |
| `funding_screen_viewed` | `methods_shown: string[]` (display order), `recommended_method_id?`, `n_visible`, `client_tz` |
| `funding_method_selected` | `method_id`, `position`, `is_recommended`, `via: 'list'\|'primary'\|'expanded'`, `ms_since_view`, `n_selected_before` |
| `funding_options_expanded` | `ms_since_view` |
| `funding_details_copied` | `method_id`, `field` (name only, never value), `ms_since_select` |
| `funding_screen_left` | `ms_on_screen`, `last_step: 'viewed'\|'selected'\|'copied'` |
| `deposit_received` / `deposit_completed` / `deposit_failed` | `deposit_id`, `method_id`, `amount_usd`, `currency` |

Each event exists because a specific Growth question needs it (§10.2). The
one question the schema cannot answer — *why* deposits fail — is a missing
provider field (`reason`) and is named in ENTREGA as the top ask.

### 8.4 Rules
1. Client clocks are not timestamps: client `occurred_at = recorded_at`
   (server). Intra-session timing uses client-measured durations.
2. Idempotent by `event_id` (client uuid); `useRef` guard against StrictMode
   double effects.
3. `navigator.sendBeacon`, fallback `fetch(…, { keepalive: true })`. Never
   blocks the screen.
4. `?preview=A|B` emits nothing and enrolls nobody.
5. No PII. `variant_shown` is what the screen rendered; server cross-checks
   against the assignment and flags mismatches.
6. Funnel counts **unique users per step**, never events.

### 8.5 Client (`src/lib/analytics.ts`)
`track(name, props)` builds the envelope (session id from `sessionStorage`,
`client_tz` from `Intl`), posts to `/api/track`. `trackEvent.ts` validates
against the catalogue (`400` for unknown name/props), stamps `recorded_at`,
`INSERT OR IGNORE`.

---

## 9. Read models and statistics

### 9.1 `experimentResults(cohort, asOf = clock.now())`

Inputs: `cohort = 'experiment'` → users with an assignment; `'baseline'` →
users with `created_at < starts_at`. Deposits from **any** source. For each
user: `firstCompletedAt = MIN(completed_at) where status='completed'`,
`firstInitiatedAt`, `firstMethodId`, failures, amounts. The 168h rule is
applied by `domain/activation.ts` — one place, tested.

Per group (variant, or whole baseline): `users`, `activated`, `rate`,
`ci95` (Wilson), `initiated_in_window`, `ever_converted`,
`median_days_to_initiate`, `recommended_share` (first deposit via the
country's recommended method), `failure_rate` (failed / final), `median_amount`,
`late_conversions`, `pending_windows` (users whose `created_at + window > asOf`).

### 9.2 `domain/stats.ts`
- `wilsonCI(k, n, z = 1.96)` per-variant interval.
- `twoProportionZTest(a, b)` → `{ z, p }` (pooled SE, two-sided, p via `erfc`).
- `diffCI(a, b)` → Wald interval on `pB − pA` with unpooled SE.
- `mde(p, nPerArm, alpha = .05, power = .8)` = `(1.96 + 0.8416) · sqrt(2p(1−p)/n)`.
- `requiredPerArm(p1, p2)` = `((1.96·sqrt(2p̄(1−p̄)) + 0.8416·sqrt(p1(1−p1)+p2(1−p2)))² / (p2−p1)²`.
- `pBBeatsA(a, b)`: Beta(1+k, 1+n−k) posteriors under the normal approximation
  → `Φ((μB−μA)/sqrt(σA²+σB²))`. Deterministic, ~5 lines; labelled as an
  approximation valid for n ≳ 50 per arm.
- Guards: any `n = 0` or pooled `p ∈ {0,1}` → `null`, never `NaN`.

### 9.3 `domain/verdict.ts`

```
insufficient_data          nA < 50 || nB < 50
b_better                   p < alpha && diff > 0
a_better                   p < alpha && diff < 0
no_detectable_difference   otherwise  (text includes MDE at current n)
provisional = pendingWindows > 0    → suffix "(provisional: N ventanas abiertas)"
```

Spanish templates (one per state), thresholds printed next to the result
(`α = 0,05, dos colas`). The sentence is generated; nobody edits it.

### 9.4 `funnelResults()` / `domain/funnel.ts`
- Steps per variant: unique users at S1…S6, step conversion, absolute drop,
  largest drop highlighted with a generated sentence.
- Per method: selected → copied → received → completed/failed; median
  copy→received hours.
- Mechanism of B: expansion rate, recommendation-followed rate, what was chosen instead.
- Friction signals: indecision distribution (`n_selected_before`), loopers
  (≥2 views, no deposit), abandoned at step (`funding_screen_left.last_step`,
  labelled lower-bound), selected ≠ deposited method.
- Last 20 events (mono, live).

### 9.5 `/api/results` shape (also what the page renders)

```
{ experiment, as_of, data_through, definition,
  primary: { A:{users,activated,rate,ci95}, B:{…}, diff_pp, diff_ci95, z, p, alpha },
  verdict: { state, provisional, text },
  baseline: { users, credited_in_window, initiated_in_window, ever_converted, rates, by_country },
  sanity: { a_vs_baseline: { z, consistent, text } },
  mechanism: { A, B, baseline, client: { exposed_users|null, expansion_rate|null, … } },
  guardrails: { A, B },
  by_country: [ { country, A, B, small_n } ],
  data_quality: { webhooks_received, unique_events, duplicates_ignored, resends_noop, deposits:{total,completed,failed,conflict}, anomalies, unknown_users, last_occurred_at },
  power: { mde_pp, table:[{lift_pp, users_needed, months_at_600}], p_b_beats_a } }
```

`definition` and `verdict` travel with the numbers so a spreadsheet gets the
caveats too.

---

## 10. Pages

### 10.1 `/results` — "¿Cuál variante convierte mejor?"

Order: status banner → verdict (`Callout`, tone by state) → two `Stat` tiles →
`DataTable` (Variante · Usuarios · Activados · Tasa · IC 95 %) → `CIBar` ×2 →
definition sentence (muted) → **Línea base — contexto, no comparación**
(`Card` with the three definitions and the A-vs-baseline warning `Callout`) →
**¿Funcionó B como se diseñó?** table (A · B · base) → **Guardrails** table →
`Disclosure` Corte por país (n<30 tagged *muestra chica*, multiple-comparisons
note) → `Disclosure` Calidad de datos → `Disclosure` Potencia (MDE table +
`P(B > A)` labelled *misma información que el IC, otra lectura*).

Rules: every rate as `k / n = %`; comparisons carry the CI, not just p; color
only when significant; client-derived rows without data say *sin datos en la
simulación*, never `0 %`; all timestamps UTC-suffixed; ITT wording
(*asignados, hayan visto o no la pantalla*).

Banner fields: experiment id, status pill (`● Corriendo` / `⏸ Pausado el
<UTC>`), cohort rule, users assigned, *datos hasta* (max `occurred_at`),
*ventanas cerradas N/N (M pendientes)*.

### 10.2 `/funnel` — "¿Dónde se traba la gente?"

Embudo por variante (stepped bars, largest drop sentence) · Por método table ·
Mecanismo de B · Señales de fricción · Últimos eventos (live). Every client
step row carries *solo usuarios que abrieron la app instrumentada*.

| Growth question | Signal |
|---|---|
| Do people freeze on the method screen? | view → select conversion, time to first select |
| Are they indecisive? | distinct methods selected before a copy |
| Do B users reject the recommendation? | expansion rate; what they pick instead |
| Are some methods' instructions scary? | select → copy drop, per method |
| Where is bank-side friction worst? | copy → received drop and delay, per method × country |
| Do they deposit with a different method than chosen? | selected `method_id` ≠ deposit `method_id` |
| Do people come back and loop? | ≥2 views, no deposit |
| Which methods fail after sending? | received → failed, per method |
| Do they give up after looking? | left with `last_step = viewed` |

### 10.3 `/u/[userId]/fund` — the two screens

Server component: load user → experiment row → `enrollUser` (unless
`?preview`) → eligible methods → recommended → `variant_shown` (A if paused or
ineligible) → `<FundingScreen …/>` (client, serializable props).

- **Ribbon** (mono, muted): `Vista: Variante B · usr_000871 · AR · asignado
  2026-08-03 UTC` — or `PREVIEW · Variante A`, or `No elegible (registro previo
  al experimento) · Variante A`, or `Experimento pausado · Variante A`.
- **A**: "Ingresar dinero"; one column of identical `MethodCard`s (name, kind
  badge, currency, *acredita en ~24 h*, *sin comisión* / *1,5 %*, secondary
  "Ver datos"). Selecting opens `InstructionsPanel` with "Copiar datos".
- **B**: one `MethodCard emphasis="hero"` (accent border, pill *Recomendado
  para Argentina*, settlement + fee prominent, primary "Copiar datos"), then a
  `Disclosure` "Ver otras opciones (N)" wrapping the same list minus the hero.
- Same component; the A/B diff in code is one prop, like on screen.
- Tracking: `funding_screen_viewed` on mount; `funding_method_selected` on
  select; `funding_options_expanded` on `<details>` toggle open;
  `funding_details_copied` on copy (uses `navigator.clipboard`, falls back to
  selecting the text); `funding_screen_left` on `pagehide`.
- `content/fundingInstructions.ts`: method → fields (`local_ar`: CBU, alias,
  titular; `local_mx`: CLABE; `local_br`: chave PIX; crypto: red, dirección;
  wire: routing, account, SWIFT; PayPal/Wise/Payoneer: email). Values are
  obviously fake sandbox patterns.

### 10.4 `/` (dev index)
`Card` with a table: one sample user per country + one pre-experiment user +
one paused-state demo; columns id (mono), flag + country, registro (UTC),
variante `Pill` or *no elegible*, link; links to `/results`, `/funnel`,
`/admin`. Links use `prefetch={false}`.

### 10.5 `/admin`
Status pill, one `Button` (Pausar / Reanudar) → `POST
/api/admin/experiments/[id]/status` → records `paused_at`. Native `confirm()`.
Unauthenticated; stated in ENTREGA.

---

## 11. UI system

Tailwind v4 + `next/font` Geist Sans/Mono, tokens in `@theme`:
`bg, surface, border, text, muted, accent, success, warning, danger`; light on
`:root`, dark under `@media (prefers-color-scheme: dark)`; `color-scheme: light
dark` on root and `<meta name="color-scheme" content="light dark">`. No toggle.

Primitives (`components/ui/`, 10–30 lines each): `Page`, `Section`, `Card`,
`Stat`, `DataTable`, `Pill`, `Callout`, `Disclosure` (native `<details>`,
keeps the marker, supports `name`), `Button`, `CIBar`. **Pages add no CSS of
their own** — a new need becomes a primitive or does not happen.

Details that make it feel finished: `tabular-nums` on every number;
`Intl.NumberFormat('es-AR')` (one decimal for rates, none for counts); 1px
borders, radius 10px; dashboard max-width 880px, funding screen 560px
mobile-first; semantic colors only for a significant verdict or a breached
guardrail; `<html lang="es">`; visible focus rings.

---

## 12. Edge cases → mitigations (condensed; the full reasoning lives in ENTREGA)

| Area | Failure | Mitigation |
|---|---|---|
| Webhook | body parsed before signature | HMAC over raw bytes, parse after |
| Webhook | `timingSafeEqual` throws on length mismatch | length check first |
| Webhook | inbox insert ok, deposit upsert crashes | single transaction |
| Webhook | DB error swallowed into 200 | 500 after parse stage |
| Webhook | unknown user / method | store, flag, 200 |
| Reducer | final before received; received after completed; both finals | creation from any type; precedence; `conflict` |
| Reducer | resend with different `occurred_at` | `min()` |
| Assignment | ineligible user visits screen | gate before insert |
| Assignment | hash changed after launch | table is truth + snapshot test |
| Assignment | allocation changed mid-flight | `allocation_version` |
| Results | zero users in a variant | `null` stats, `insufficient_data` |
| Results | right-censoring | `asOf`, `pending_windows`, provisional verdict |
| Results | ten country cuts, one "wins" by chance | small-n tag + note, collapsed |
| Tracking | `<Link>` prefetch renders the page | assignment server-side, exposure client-side, `prefetch={false}` |
| Tracking | StrictMode double effect | `useRef` + `event_id` dedupe |
| Next | `/results` statically prerendered by `next build` | `await connection()` before every DB read in pages (Next 16 removed `force-dynamic` under Cache Components; `connection()` works in both models) |
| Next | cold compile > 10s simulator timeout | `replay.sh` warm-up |
| Next | HMR reopens DB | `globalThis` cache, `IF NOT EXISTS` |
| Simulator | silent partial run | README uses `--stop-on-error` |
| Simulator | `--no-signature` | `WEBHOOK_VERIFY_SIGNATURE=false` documented |
| Kill switch | paused read as live | banner + `paused_at` |
| Recommendation | country without local method | fallback chain + property test |

---

## 13. Tests (`vitest`) — where they matter and why

| File | What it pins | Why here |
|---|---|---|
| `domain/time.test.ts` | strict parsing (naive rejected, offset normalized), format round-trip | the only door in |
| `domain/assignment.test.ts` | snapshot for known users; balance ±5% over 1200 ids; determinism | reported number depends on it |
| `domain/deposit.test.ts` | every permutation of a deposit's events (+dupes) → same state; failed-first; received-after-completed; conflict | the async trap |
| `domain/activation.test.ts` | 167h59, 168h00 in; 168h01 out; completion before signup → not activated | the metric |
| `domain/recommendation.test.ts` | every country gets an eligible method; hero excluded from list | B's correctness |
| `domain/stats.test.ts` | textbook z/CI case; `n=0` guards; MDE monotonic | verdict depends on it |
| `domain/verdict.test.ts` | four states + provisional | the sentence Growth reads |
| `domain/funnel.test.ts` | unique users per step; order-independent | no funnel inflation |
| `domain/events.test.ts` | one fixture per event validates; extra prop fails | catalogue drift |
| `services/ingestWebhook.test.ts` | replayed `event_id` → 200, no write; resend → no transition; bad signature → 401; malformed → 400 | contract |
| `replay.test.ts` | whole `scenario.json` in-process → 606/299/254/45/0 and 210/600, A 113/296, B 97/304 | the answer |
| `architecture.test.ts` | no `Date` in `src/domain` outside `time.ts` | the time guarantee |

`npm run test:tz` runs the suite under `TZ=UTC`, `America/Argentina/Buenos_Aires`,
`Asia/Tokyo`, `Pacific/Chatham`; results must be identical.

---

## 14. Scripts, config, operations

`package.json` scripts:

```
dev            TZ=UTC next dev
build          next build
start          TZ=UTC next start
setup          npm ci && npm run db:reset && npm run seed
db:reset       tsx scripts/reset.ts
seed           tsx scripts/seed.ts
replay         bash scripts/replay.sh            # health warm-up → python3 simulator --url http://localhost:3000 --stop-on-error
verify         python3 scripts/verify.py         # independent recomputation vs /api/results
test           vitest run
test:tz        TZ=UTC vitest run && TZ=America/Argentina/Buenos_Aires vitest run && TZ=Asia/Tokyo vitest run && TZ=Pacific/Chatham vitest run
lint           next lint / eslint
```

`.env.example` (defaults make a clean clone work with no env at all):

```
DB_PATH=var/wallbit.db
WEBHOOK_SECRET=whsec_sandbox_wallbit
WEBHOOK_VERIFY_SIGNATURE=true
```

`seed.ts`: idempotent upserts for users / methods; `INSERT OR IGNORE` for
historical deposits (`source='historical'`, `initiated_at=created_at`,
`status='completed'`); experiment row from the constant; enroll eligible
users with `assigned_at = created_at` + `experiment_assigned` events. Prints
counts. Reseeding never wipes webhook data; only `db:reset` does.

`/api/health`: `{ ok: true, db: 'ready' }` — used by the warm-up.

Anomalies are logged as one-line `console.warn('[webhook] anomaly …')` and
counted on the dashboard. No logging library.

---

## 15. Phases and acceptance criteria

No time budget. A phase is done when its acceptance holds and its commit is in.

**Phase 0 — Scaffold.** ✅ `phase-0` commit (41a5031).
`create-next-app@latest` (TS, ESLint, Tailwind, `src/`, App Router, alias
`@/*`, no React Compiler) generated in the scratchpad and moved in (the CLI
refuses a non-empty directory); `vitest` + `tsx` + `zod`; scripts; `.nvmrc`;
`.env.example`; `next.config.ts`; `vitest.config.ts` with the `@/` alias;
README skeleton. *Accept:* `npm run dev` serves a page; `npm test` runs an
empty suite; lint clean.

**Phase 1 — Time, DB, seed.** ✅ `phase-1` commit.
`domain/time.ts` + tests; `infra/db.ts`, `schema.sql`, repos; `scripts/seed.ts`,
`reset.ts`; `/api/health`. *Accept:* `npm run seed` prints 1200 users / 16
methods / 201 historical deposits / 600 assignments; running it again changes
nothing; `architecture.test.ts` passes.
*As built:* `domain/experiment.ts`, `domain/assignment.ts` and the
`domain/events.ts` skeleton (envelope + system/webhook events) came forward
from Phase 2 because the seed enrolls users. Seed logic lives in
`services/seed.ts` (testable on `:memory:`); `scripts/seed.ts` is the CLI.
`infra/db.ts` exposes `queryAll/queryOne/queryRow` because `node:sqlite` types
rows as `Record<string, SQLOutputValue>`. Turbopack warns that the
runtime-configurable DB path defeats output-file tracing — irrelevant without
a standalone deploy, noted here so nobody chases it.

**Phase 2 — Domain rules.** ✅ `phase-2` commit.
`experiment`, `assignment`, `recommendation`, `deposit`, `activation` + tests.
*Accept:* all green under `npm run test:tz`.
*As built:* `domain/fundingMethod.ts` and `domain/provider.ts` (zod contract
for the raw webhook payload → typed `DepositEvent`) were added so the repos
import types from the domain, not the reverse. The permutation test caught a
real order-dependence in the reducer (amount followed the *last* final event
in a `completed`+`failed` conflict); payload fields now follow event-type
precedence `completed > failed > received`. `tests/replay.test.ts` came
forward from Phase 4: the domain alone reproduces §19 from `scenario.json`
(606 unique / 42 dupes / 299 deposits / 598 transitions / 210 of 600 /
A 113/296, B 97/304) and is invariant to a double replay and to reversed
delivery order.

**Phase 3 — Webhook ingestion.** ✅ `phase-3` commit.
`ingestWebhook.ts`, route, inbox, domain events, `replay.sh`. *Accept:* §7.3
numbers; second replay identical; `ingestWebhook.test.ts` green.
*As built:* `services/webhookSignature.ts` (HMAC over raw bytes, length
check before `timingSafeEqual`), `infra/config.ts` (env with defaults).
Ingestion anomalies: `user_unknown`, `method_unknown`, `non_positive_amount`,
`deposit_before_signup`, `country_mismatch`, `occurred_in_future` (+5 min
tolerance) plus the reducer's `user_mismatch`/`method_mismatch`; all stored on
the inbox row, none rejected. Live run: 648 deliveries → 606 inbox / 299
deposits (254/45/0) / 598 domain events, ~3 ms per webhook; second replay left
the database byte-identical (648 duplicates).

**Phase 4 — Results read model, stats, verdict, JSON, verify.** ✅ `phase-4` commit.
`experimentResults.ts`, `stats.ts`, `verdict.ts`, `/api/results`,
`scripts/verify.py`. *Accept:* `A 113/296, B 97/304`, baseline `138/600`,
`npm run verify` prints `MATCH`; `replay.test.ts` green.
*As built:* `webhook_inbox.deliveries` counter (guarded `ALTER TABLE`
migration in `db.ts`) so the data-quality panel can show 648 / 606 / 42.
Verdict *decision* is domain (`verdict.ts`); the Spanish *sentence* is
presentation (`content/verdict.ts`) because it needs `Intl`. `lib/format.ts`
holds all es-AR formatting. The read model measures mechanism/timing rows
over ever-converted users; failure rate only over webhook-sourced deposits
(historical data has none → baseline shows *sin datos*). The power table uses
the control rate and the observed signup pace (1 639/month = 600 users in 11
days), not the planning-time 600/month assumption — so "+5 pp" reads ~1.8
months here. Live: `npm run verify` → `MATCH` on 20 fields.

**Phase 5 — UI system, funding screens, tracking, funnel.**
tokens + primitives; `FundingScreen` A/B + instructions + ribbon + preview;
`analytics.ts`, `/api/track`, `trackEvent.ts`; `funnelResults.ts`, `/funnel`,
`/api/funnel`. *Accept:* clicking through a user produces the expected event
sequence; `/funnel` shows it; preview emits nothing; events tests green.

**Phase 6 — Results page, admin, index.**
`/results` per §10.1; `/admin` + `experimentControl.ts`; `/`. *Accept:* page
matches the spec in light and dark; pause → funding page shows A with the
paused ribbon and `/results` shows the banner; resume restores.

**Phase 7 — Documentation and rehearsal.**
`README.md` (ES) with checkpoints and "Dónde mirar"; `ENTREGA.md` complete
with real numbers; full rehearsal (§17); final commit. *Accept:* a clean clone
following the README reaches `MATCH` without touching anything else.

---

## 16. `ENTREGA.md` outline (Spanish, brief; half a page honest beats three pages)

- **Cómo correrlo** — exact commands, from a clean clone.
- **Qué construí y qué dejé afuera** — priority order *as if the 4h cap
  existed* (1–6 minimal first, then each extra and why it is small and
  finished); *Dejé afuera*: auth, migrations tooling, Temporal, second
  experiment UI, real no-deploy switch semantics, provider `reason` field,
  rate limiting; *Si tuviera 4 horas más*.
- **Asignación de variantes** — hash + table + version; why deterministic.
- **Modelo de eventos** — the question → event table; the one unanswerable question.
- **Línea base y objetivo** *(added section)* — the three definitions, the
  decomposition (slow starters −6.3pp, settlement −4.2pp), MDE and sample
  table, the A-vs-baseline confound paragraph.
- **Embudo y dolores del flujo** *(added section)* — what `/funnel` answers and
  that August has no client events by construction.
- **El resultado** — the table with real numbers; *convertido* defined exactly
  (what is counted, what is excluded: received, failed, late, pre-experiment);
  *¿Lanzarías B?* — no: no detectable effect ≥ ~10pp, and the simulator is
  variant-blind; a +5pp effect needs ~4 months at current signup volume; the
  design is ready to keep running.
- **Supuestos y decisiones de criterio** — §1 nearly verbatim.
- **Lo que sé que está flojo** — open admin, spoofable `/api/track`, ITT vs
  exposed, `initiated_at` proxy, no failure reasons, normal-approx Bayes,
  single-process SQLite, best-effort abandonment event.
- **Uso de IA** — design iterated with Claude (this plan); every line
  understood and defended; what was generated vs written.
- **Tiempo** — honest hours including planning.

---

## 17. Live-call rehearsal and extension points

Demo order (also the acceptance for Phase 7):
`npm run setup` → `npm run dev` → `npm run replay` → `/results` (verdict, data
quality 606/299) → `/u/<user>/fund?preview=A` and `?preview=B` → click through
as a real B user → `/funnel` shows the events live → `/admin` pause → funding
page shows A with ribbon → `/results` banner → resume → `npm run replay`
again → numbers unchanged → `npm run verify` → `MATCH` → `npm run test:tz`.

Likely live asks, each designed to be a ≤10-line change:

| Ask | Where | Shape |
|---|---|---|
| Add variant C | `experiments.allocation` + `FundingScreen` mapping | data + 1 file |
| Second experiment in parallel | new `experiments` row | data only (`experiment_id` everywhere, composite PK) |
| Window 7 → 10 days | `windowHours` | 1 value |
| Cut by KYC | one extra group-by in `experimentResults` | ~5 lines |
| New client event | catalogue entry + zod + one `track()` | ~15 lines |
| New webhook type (`deposit.reversed`) | reducer precedence + branch | ~10 lines |
| Change recommendation rule | `recommendedMethodFor` | 1 function |
| Pause | `/admin` | click |

---

## 18. Known gaps (go verbatim into "Lo que sé que está flojo")

Open `/admin`; `/api/track` trusts `user_id`; ITT denominator (exposed cut
available but not the headline); `initiated_at` is a proxy (`received`, not
"user pressed send"); no failure reasons (provider field missing);
`P(B > A)` is a normal approximation; single-process SQLite (Postgres notes
in ENTREGA: `INSERT … ON CONFLICT DO NOTHING RETURNING`); `funding_screen_left`
is lower-bound; no rate limiting; no auth anywhere; kill switch is a DB flag,
not a feature-flag service.

---

## 19. Reference numbers (reconcile against these at every phase)

| Item | Value |
|---|---|
| Users | 1200 (600 pre / 600 eligible); 10 countries; last signup 2026-08-11T23:48:25Z |
| Funding methods | 16; local: AR MX CO BR PE BO GT DO; none for UY, ES |
| Historical deposits | 201, all completed, 201 distinct pre-experiment users |
| Scenario | 648 deliveries; 606 unique `event_id`; 42 duplicates; 8 resends; 36 `occurred_at` inversions; first event is a `failed` |
| Deposits after replay | 299 = 254 completed + 45 failed + 0 conflict; 285 users; 14 users with failed+completed; 0 with two completed |
| Activation (experiment cohort) | **210 / 600 = 35.0 %**; 44 late (8.0–20.4 d); 31 failed-only users |
| Split (sha256, `funding_recommended_v1`) | **A 113/296 = 38.2 %, B 97/304 = 31.9 %**; z = −1.61, p = 0.108; diff −6.3 pp |
| Baseline | credited ≤168h 138/600 = 23.0 %; initiated 163/600 = 27.2 %; ever 201/600 = 33.5 %; A vs baseline z = 4.76 |
| Baseline by country | AR 22.7 · MX 31.8 · CO 23.8 · BR 30.8 · PE 8.2 · UY 25.0 · BO 4.2 · DO 21.1 · GT 14.3 · ES 36.4 (%) |
| Mechanism (baseline) | 11 % of activators used their local method; median 2.9 d to initiate; median 29.3 h to credit |
| Failure rate by kind (August) | third_party 11 % · crypto 16 % · bank 20 % · local 20 % |
| Power | MDE ≈ +9.6 pp at 300/arm (p = .23); +5 pp needs ~2 400 users (~4 months) |
| Windows | all closed by 2026-08-18T23:48:25Z; last event 2026-08-30T15:27:00Z |
| Cutoff sensitivity | 00:00Z → 600 eligible; 03:00Z (ART midnight) → 595 |
