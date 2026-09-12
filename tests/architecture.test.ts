// Why here: the time guarantee is structural, not behavioral. If a Date call
// appears in a domain rule, tests under one time zone can still pass while
// production in another is wrong. This test makes the rule unbreakable.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const DOMAIN_DIR = path.join(process.cwd(), "src", "domain");
const ALLOWED = new Set(["time.ts"]);
const FORBIDDEN = [/\bnew Date\(/, /\bDate\.now\(/, /\bDate\.parse\(/, /\bDate\.UTC\(/, /\.toLocale/, /\.getHours\(/, /\.getDate\(/, /\.getTimezoneOffset\(/, /\bIntl\./];

describe("src/domain", () => {
  it("never touches Date or civil time outside time.ts", () => {
    const offenders: string[] = [];
    for (const file of readdirSync(DOMAIN_DIR)) {
      if (!file.endsWith(".ts") || ALLOWED.has(file)) continue;
      const source = readFileSync(path.join(DOMAIN_DIR, file), "utf8");
      for (const pattern of FORBIDDEN) {
        if (pattern.test(source)) offenders.push(`${file}: ${pattern}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
