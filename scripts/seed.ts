import { openDb } from "@/infra/db";
import { seedDatabase } from "@/services/seed";

// Loads data/*.json into the SQLite file and enrolls eligible users.
// Safe to run repeatedly: a second run reports "+0" on every line.
const db = openDb();
const r = seedDatabase(db);

const line = (label: string, total: number, added: number) =>
  console.log(`  ${label.padEnd(22)} ${String(total).padStart(5)}  (+${added})`);

console.log(`seeded ${process.env.DB_PATH ?? "var/wallbit.db"}`);
line("users", r.users.total, r.users.added);
line("funding methods", r.methods.total, r.methods.added);
line("historical deposits", r.historicalDeposits.total, r.historicalDeposits.added);
console.log(
  `  ${"experiment".padEnd(22)} ${r.experiment.id}  (${r.experiment.created ? "created" : "already present"})`,
);
const byVariant = Object.entries(r.assignments.byVariant)
  .map(([v, n]) => `${v}=${n}`)
  .join(" ");
line(`assignments (${byVariant})`, Object.values(r.assignments.byVariant).reduce((a, b) => a + b, 0), r.assignments.added);
console.log(`  ${"not eligible".padEnd(22)} ${String(r.assignments.ineligible).padStart(5)}  (signed up before the experiment)`);
line("events", r.events.total, r.events.added);
db.close();
