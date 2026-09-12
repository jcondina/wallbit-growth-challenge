-- Wallbit growth challenge — SQLite schema.
--
-- Conventions
--   * Every *_at column is epoch MILLISECONDS stored as INTEGER, guarded by a
--     typeof() check so a stray ISO string or float can never sneak in.
--     A virtual *_at_iso twin exists purely for humans browsing the file.
--   * No DEFAULT CURRENT_TIMESTAMP anywhere: the application writes every
--     timestamp through domain/time.ts. No SQLite date functions in queries.
--   * All statements are idempotent (IF NOT EXISTS) so the bootstrap can run
--     on every process start, including Next.js hot reloads.

CREATE TABLE IF NOT EXISTS users (
  id             TEXT PRIMARY KEY,
  email          TEXT NOT NULL,
  country        TEXT NOT NULL,
  created_at     INTEGER NOT NULL CHECK (typeof(created_at) = 'integer'),
  kyc_status     TEXT NOT NULL CHECK (kyc_status IN ('approved', 'pending', 'rejected')),
  created_at_iso TEXT GENERATED ALWAYS AS
    (strftime('%Y-%m-%dT%H:%M:%fZ', created_at / 1000.0, 'unixepoch')) VIRTUAL
);

CREATE TABLE IF NOT EXISTS funding_methods (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  kind             TEXT NOT NULL CHECK (kind IN ('local_transfer', 'bank_transfer', 'crypto', 'third_party')),
  currency         TEXT NOT NULL,
  countries        TEXT NOT NULL,          -- JSON array of ISO codes; "*" means everywhere. Evaluated in TS.
  settlement_hours INTEGER NOT NULL,
  fee_pct          REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS experiments (
  id                 TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  starts_at          INTEGER NOT NULL CHECK (typeof(starts_at) = 'integer'),
  ends_at            INTEGER CHECK (ends_at IS NULL OR typeof(ends_at) = 'integer'),
  window_hours       INTEGER NOT NULL,
  status             TEXT NOT NULL CHECK (status IN ('running', 'paused', 'finished')),
  paused_at          INTEGER CHECK (paused_at IS NULL OR typeof(paused_at) = 'integer'),
  allocation         TEXT NOT NULL,        -- JSON [{"variant":"A","weight":50}, ...]
  allocation_version INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS assignments (
  experiment_id      TEXT NOT NULL,
  user_id            TEXT NOT NULL,
  variant            TEXT NOT NULL,
  allocation_version INTEGER NOT NULL,
  assigned_at        INTEGER NOT NULL CHECK (typeof(assigned_at) = 'integer'),
  assigned_at_iso    TEXT GENERATED ALWAYS AS
    (strftime('%Y-%m-%dT%H:%M:%fZ', assigned_at / 1000.0, 'unixepoch')) VIRTUAL,
  PRIMARY KEY (experiment_id, user_id)
);

-- Raw at-least-once log of provider deliveries. Dedupe layer 1 (event_id).
CREATE TABLE IF NOT EXISTS webhook_inbox (
  event_id        TEXT PRIMARY KEY,
  event_type      TEXT NOT NULL,
  deposit_id      TEXT NOT NULL,
  occurred_at     INTEGER NOT NULL CHECK (typeof(occurred_at) = 'integer'),
  received_at     INTEGER NOT NULL CHECK (typeof(received_at) = 'integer'),
  signature_ok    INTEGER NOT NULL CHECK (signature_ok IN (0, 1)),
  header_mismatch INTEGER NOT NULL DEFAULT 0 CHECK (header_mismatch IN (0, 1)),
  anomalies       TEXT,                    -- JSON array of strings; NULL when clean
  payload         TEXT NOT NULL,           -- raw body as delivered
  deliveries      INTEGER NOT NULL DEFAULT 1,  -- how many times this event_id arrived (at-least-once)
  occurred_at_iso TEXT GENERATED ALWAYS AS
    (strftime('%Y-%m-%dT%H:%M:%fZ', occurred_at / 1000.0, 'unixepoch')) VIRTUAL
);
CREATE INDEX IF NOT EXISTS webhook_inbox_deposit ON webhook_inbox (deposit_id, event_type);

-- Deposit state, keyed by the provider's deposit_id. Dedupe layer 2 (reducer).
-- No foreign key to users on purpose: an unknown user is stored and flagged,
-- never rejected (a 4xx would make the provider retry forever).
CREATE TABLE IF NOT EXISTS deposits (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL,
  method_id        TEXT NOT NULL,
  amount_usd       REAL NOT NULL,
  currency         TEXT,
  country          TEXT,
  status           TEXT NOT NULL CHECK (status IN ('received', 'completed', 'failed', 'conflict')),
  initiated_at     INTEGER CHECK (initiated_at IS NULL OR typeof(initiated_at) = 'integer'),
  completed_at     INTEGER CHECK (completed_at IS NULL OR typeof(completed_at) = 'integer'),
  failed_at        INTEGER CHECK (failed_at IS NULL OR typeof(failed_at) = 'integer'),
  source           TEXT NOT NULL CHECK (source IN ('webhook', 'historical')),
  user_known       INTEGER NOT NULL DEFAULT 1 CHECK (user_known IN (0, 1)),
  updated_at       INTEGER NOT NULL CHECK (typeof(updated_at) = 'integer'),
  completed_at_iso TEXT GENERATED ALWAYS AS
    (strftime('%Y-%m-%dT%H:%M:%fZ', completed_at / 1000.0, 'unixepoch')) VIRTUAL
);
CREATE INDEX IF NOT EXISTS deposits_user ON deposits (user_id);

-- Append-only analytics log (client, webhook-derived and system events).
CREATE TABLE IF NOT EXISTS events (
  event_id        TEXT PRIMARY KEY,        -- uuid (client) | dep:{id}:{type} (webhook) | assign:{exp}:{user} (system)
  name            TEXT NOT NULL,
  user_id         TEXT NOT NULL,
  occurred_at     INTEGER NOT NULL CHECK (typeof(occurred_at) = 'integer'),
  recorded_at     INTEGER NOT NULL CHECK (typeof(recorded_at) = 'integer'),
  source          TEXT NOT NULL CHECK (source IN ('client', 'webhook', 'system')),
  experiment_id   TEXT,
  variant_shown   TEXT,
  country         TEXT,
  session_id      TEXT,
  schema_version  INTEGER NOT NULL DEFAULT 1,
  props           TEXT NOT NULL,           -- JSON, validated against the catalogue before insert
  occurred_at_iso TEXT GENERATED ALWAYS AS
    (strftime('%Y-%m-%dT%H:%M:%fZ', occurred_at / 1000.0, 'unixepoch')) VIRTUAL
);
CREATE INDEX IF NOT EXISTS events_user_name ON events (user_id, name);
CREATE INDEX IF NOT EXISTS events_name_time ON events (name, occurred_at);
