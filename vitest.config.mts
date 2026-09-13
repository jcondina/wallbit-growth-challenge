import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Tests import the app through the same "@/…" alias tsconfig defines.
// No React/jsdom here: everything under tests/ is pure TypeScript
// (domain rules, services against an in-memory SQLite).
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Persist TypeScript → JS transforms in node_modules/.vitest-cache
    // (keyed by content hash, so edits invalidate themselves). Without it
    // every run re-transforms src/ from scratch: ~40 % of the run.
    fsModuleCache: true,
  },
});
