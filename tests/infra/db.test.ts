// Why here: the schema's typeof() checks and the transaction helper are the
// two mechanisms that make "a wrong timestamp cannot be stored" and "an
// event is never half-applied" true. Both must be proven, not assumed.
import { describe, expect, it } from "vitest";
import { openDb, tx } from "@/infra/db";

describe("openDb(':memory:')", () => {
  it("applies the schema idempotently", () => {
    const db = openDb(":memory:");
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[]).map((r) => r.name);
    expect(tables).toEqual(["assignments", "deposits", "events", "experiments", "funding_methods", "users", "webhook_inbox"]);
    expect(() => openDb(":memory:")).not.toThrow();
  });

  it("rejects non-integer timestamps at the storage layer", () => {
    const db = openDb(":memory:");
    const insert = db.prepare("INSERT INTO users (id, email, country, created_at, kyc_status) VALUES (?, ?, ?, ?, ?)");
    expect(() => insert.run("u1", "e", "AR", "2026-08-01T00:00:00Z", "approved")).toThrow(/CHECK constraint failed/);
    expect(() => insert.run("u2", "e", "AR", 1785542400000.5, "approved")).toThrow(/CHECK constraint failed/);
    expect(() => insert.run("u3", "e", "AR", 1785542400000, "approved")).not.toThrow();
  });

  it("exposes a generated ISO twin for humans", () => {
    const db = openDb(":memory:");
    db.prepare("INSERT INTO users (id, email, country, created_at, kyc_status) VALUES (?, ?, ?, ?, ?)").run("u", "e", "AR", 1785542400000, "approved");
    const row = db.prepare("SELECT created_at_iso FROM users WHERE id = 'u'").get() as { created_at_iso: string };
    expect(row.created_at_iso).toBe("2026-08-01T00:00:00.000Z");
  });
});

describe("tx", () => {
  it("commits on success and rolls back on throw", () => {
    const db = openDb(":memory:");
    const insert = () => db.prepare("INSERT INTO funding_methods (id, name, kind, currency, countries, settlement_hours, fee_pct) VALUES (?, ?, ?, ?, ?, ?, ?)");
    tx(db, () => insert().run("m1", "n", "crypto", "USDT", "[\"*\"]", 1, 0));
    expect(() =>
      tx(db, () => {
        insert().run("m2", "n", "crypto", "USDC", "[\"*\"]", 1, 0);
        throw new Error("boom");
      }),
    ).toThrow("boom");
    const ids = (db.prepare("SELECT id FROM funding_methods ORDER BY id").all() as { id: string }[]).map((r) => r.id);
    expect(ids).toEqual(["m1"]);
    // the connection is usable again after a rollback
    expect(() => tx(db, () => insert().run("m3", "n", "crypto", "USDC", "[\"*\"]", 1, 0))).not.toThrow();
  });
});
