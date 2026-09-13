import { Callout } from "@/components/ui/Callout";
import { Card } from "@/components/ui/Card";
import { BASELINE_CAVEAT } from "@/content/copy";
import type { ZTest } from "@/domain/stats";
import { formatNum1, formatP, formatPct, formatRatio } from "@/lib/format";
import type { GroupStats } from "@/services/experimentResults";

interface Props {
  baseline: GroupStats;
  controlRate: number | null;
  sanity: { controlVsBaseline: ZTest | null; consistent: boolean | null };
}

/** Context, not the comparison group — and the sanity check that proves it. */
export function BaselineCard({ baseline, controlRate, sanity }: Props) {
  const z = sanity.controlVsBaseline;
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <p className="text-sm text-muted">Cohorte previa al experimento · misma definición · {baseline.users} usuarios</p>
        <dl className="mt-3 grid gap-3 sm:grid-cols-3">
          <div>
            <dt className="text-xs text-muted">Acreditado ≤ 168 h</dt>
            <dd className="text-lg font-semibold">{formatRatio(baseline.activated, baseline.users)}</dd>
            <dd className="text-xs text-muted">la métrica de activación</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Inició un depósito ≤ 168 h</dt>
            <dd className="text-lg font-semibold">{formatRatio(baseline.initiatedInWindow, baseline.users)}</dd>
            <dd className="text-xs text-muted">lo que la pantalla puede mover</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Depositó alguna vez</dt>
            <dd className="text-lg font-semibold">{formatRatio(baseline.everConverted, baseline.users)}</dd>
            <dd className="text-xs text-muted">el «un tercio» del enunciado</dd>
          </div>
        </dl>
      </Card>
      {z && sanity.consistent === false ? (
        <Callout tone="warning" title={`El control A (${formatPct(controlRate)}) también supera la línea base (${formatPct(baseline.rate)}) · z = ${formatNum1(z.z)}, ${formatP(z.p)}`}>
          {BASELINE_CAVEAT}
        </Callout>
      ) : (
        <Callout tone="neutral" title="Control y línea base son consistentes">
          {BASELINE_CAVEAT}
        </Callout>
      )}
    </div>
  );
}
