import { notFound } from "next/navigation";
import { connection } from "next/server";
import { FundingScreen } from "@/components/funding/FundingScreen";
import { countryName } from "@/content/copy";
import { instructionsFor } from "@/content/fundingInstructions";
import { FUNDING_EXPERIMENT } from "@/domain/experiment";
import { eligibleMethodsFor, recommendedMethodFor } from "@/domain/recommendation";
import { systemClock } from "@/domain/time";
import { getDb } from "@/infra/db";
import { getExperiment } from "@/infra/repos/experiments";
import { listFundingMethods } from "@/infra/repos/fundingMethods";
import { getUser } from "@/infra/repos/users";
import { formatUtc } from "@/lib/format";
import { type EnrollOutcome, enrollUser } from "@/services/enrollUser";

// /u/[userId]/fund — the screen under test. No auth by design (the brief):
// the path says who the user is. `?preview=A|B` renders a variant without
// enrolling or tracking, for the live walkthrough.
export default async function FundPage({ params, searchParams }: PageProps<"/u/[userId]/fund">) {
  await connection(); // synchronous SQLite reads must never be prerendered
  const { userId } = await params;
  const { preview } = await searchParams;

  const db = getDb();
  const user = getUser(db, userId);
  if (!user) notFound();

  const experiment = getExperiment(db, FUNDING_EXPERIMENT.id) ?? FUNDING_EXPERIMENT;
  const previewVariant = typeof preview === "string" && preview !== "" ? preview : null;
  const outcome = enrollUser(db, systemClock, user, experiment, { preview: previewVariant });

  const catalogue = listFundingMethods(db);
  const methods = eligibleMethodsFor(user.country, catalogue);
  const recommended = recommendedMethodFor(user.country, catalogue);
  const instructions = Object.fromEntries(methods.map((m) => [m.id, instructionsFor(m.id, user.id)]));

  return (
    <FundingScreen
      user={{ id: user.id, country: user.country, countryName: countryName(user.country) }}
      experimentId={experiment.id}
      variant={outcome.variantShown}
      ribbon={ribbonFor(outcome, user.id, user.country)}
      tracking={outcome.reason !== "preview"}
      recommended={recommended}
      methods={methods}
      instructions={instructions}
    />
  );
}

function ribbonFor(o: EnrollOutcome, userId: string, country: string): { text: string; tone: "muted" | "warning" } {
  const who = `${userId} · ${country}`;
  switch (o.reason) {
    case "preview":
      return { text: `PREVIEW · Variante ${o.variantShown} · ${who} · sin tracking ni asignación`, tone: "warning" };
    case "ineligible":
      return { text: `No elegible (registro previo al experimento) · Variante ${o.variantShown} · ${who}`, tone: "muted" };
    case "paused":
    case "finished":
      return {
        text: `Experimento ${o.reason === "paused" ? "pausado" : "finalizado"} · Variante ${o.variantShown} · ${who}` +
          (o.assignment ? ` · asignado ${o.assignment.variant} el ${formatUtc(o.assignment.assignedAt)}` : ""),
        tone: "warning",
      };
    case "assigned":
    case "enrolled":
      return {
        text: `Vista: Variante ${o.variantShown} · ${who} · asignado ${formatUtc(o.assignment?.assignedAt ?? null)}`,
        tone: "muted",
      };
  }
}
