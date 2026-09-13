import type { FundingMethod, MethodKind } from "@/domain/fundingMethod";
import { type Db, queryAll, queryOne, queryRow, statement } from "../db";

export type { FundingMethod, MethodKind };

interface Row {
  id: string;
  name: string;
  kind: MethodKind;
  currency: string;
  countries: string;
  settlement_hours: number;
  fee_pct: number;
}

const toMethod = (r: Row): FundingMethod => ({
  id: r.id,
  name: r.name,
  kind: r.kind,
  currency: r.currency,
  countries: JSON.parse(r.countries) as string[],
  settlementHours: r.settlement_hours,
  feePct: r.fee_pct,
});

export function upsertFundingMethods(db: Db, methods: FundingMethod[]): void {
  const stmt = statement(db, `
    INSERT INTO funding_methods (id, name, kind, currency, countries, settlement_hours, fee_pct)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (id) DO UPDATE SET
      name = excluded.name, kind = excluded.kind, currency = excluded.currency,
      countries = excluded.countries, settlement_hours = excluded.settlement_hours,
      fee_pct = excluded.fee_pct
  `);
  for (const m of methods) {
    stmt.run(m.id, m.name, m.kind, m.currency, JSON.stringify(m.countries), m.settlementHours, m.feePct);
  }
}

export function getFundingMethod(db: Db, id: string): FundingMethod | null {
  const row = queryOne<Row>(db, "SELECT * FROM funding_methods WHERE id = ?", id);
  return row ? toMethod(row) : null;
}

export function listFundingMethods(db: Db): FundingMethod[] {
  return (queryAll<Row>(db, "SELECT * FROM funding_methods ORDER BY rowid")).map(toMethod);
}

export function countFundingMethods(db: Db): number {
  return queryRow<{ n: number }>(db, "SELECT COUNT(*) AS n FROM funding_methods").n;
}
