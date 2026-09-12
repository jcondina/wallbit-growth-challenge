import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { DEFAULT_DB_PATH } from "@/infra/db";

// Deletes the SQLite file (and its WAL/SHM sidecars). The next `npm run seed`
// or app start recreates the schema from scratch.
const file = path.resolve(process.cwd(), process.env.DB_PATH ?? DEFAULT_DB_PATH);
let removed = 0;
for (const suffix of ["", "-wal", "-shm"]) {
  const p = file + suffix;
  if (existsSync(p)) {
    rmSync(p);
    removed += 1;
  }
}
console.log(removed === 0 ? `nothing to reset at ${file}` : `removed ${file} (${removed} file${removed === 1 ? "" : "s"})`);
