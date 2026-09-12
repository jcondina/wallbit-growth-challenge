import { InvalidInstant, formatInstant, parseInstant } from "@/domain/time";
import { ACTIVATION_DEFINITION, BASELINE_CAVEAT, COUNTRY_CUT_CAVEAT } from "@/content/copy";
import { verdictText } from "@/content/verdict";
import { getDb } from "@/infra/db";
import { experimentResults } from "@/services/experimentResults";

// GET /api/results[?asOf=2026-08-31T00:00:00Z]
// Same read model as the /results page. The metric definition and the
// generated verdict sentence travel with the numbers on purpose.
export async function GET(request: Request) {
  const asOfParam = new URL(request.url).searchParams.get("asOf");
  let asOf;
  if (asOfParam !== null) {
    try {
      asOf = parseInstant(asOfParam);
    } catch (error) {
      if (error instanceof InvalidInstant) return Response.json({ error: error.message }, { status: 400 });
      throw error;
    }
  }

  const r = experimentResults(getDb(), { asOf });
  return Response.json({
    experiment: {
      ...r.experiment,
      startsAt: formatInstant(r.experiment.startsAt),
      endsAt: r.experiment.endsAt === null ? null : formatInstant(r.experiment.endsAt),
      pausedAt: r.experiment.pausedAt === null ? null : formatInstant(r.experiment.pausedAt),
    },
    asOf: formatInstant(r.asOf),
    dataThrough: r.dataThrough === null ? null : formatInstant(r.dataThrough),
    definition: ACTIVATION_DEFINITION,
    variants: r.variants,
    comparison: r.comparison,
    verdict: r.verdict === null ? null : { ...r.verdict, text: verdictText(r.verdict) },
    baseline: { ...r.baseline, caveat: BASELINE_CAVEAT },
    sanity: r.sanity,
    client: r.client,
    byCountry: { caveat: COUNTRY_CUT_CAVEAT, cuts: r.byCountry },
    dataQuality: {
      ...r.dataQuality,
      inbox: {
        ...r.dataQuality.inbox,
        lastOccurredAt: r.dataQuality.inbox.lastOccurredAt === null ? null : formatInstant(r.dataQuality.inbox.lastOccurredAt),
      },
    },
    power: r.power,
  });
}
