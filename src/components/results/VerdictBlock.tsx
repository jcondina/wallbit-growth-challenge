import { CIBar } from "@/components/ui/CIBar";
import { Callout } from "@/components/ui/Callout";
import { DataTable } from "@/components/ui/DataTable";
import { Stat } from "@/components/ui/Stat";
import { ACTIVATION_DEFINITION } from "@/content/copy";
import { verdictText, verdictTone } from "@/content/verdict";
import type { Variant } from "@/domain/experiment";
import type { Verdict } from "@/domain/verdict";
import { formatInt, formatP, formatPct, formatPctRange, formatPp, formatPpRange } from "@/lib/format";
import type { Comparison, GroupStats } from "@/services/experimentResults";

interface Props {
  variants: Record<Variant, GroupStats>;
  comparison: Comparison | null;
  verdict: Verdict | null;
}

const LABEL: Record<string, string> = { A: "A (control)", B: "B (recomendado)" };
const label = (v: Variant) => LABEL[v] ?? v;

/** The answer, then the numbers behind it, then the definition they rest on. */
export function VerdictBlock({ variants, comparison, verdict }: Props) {
  const names = Object.keys(variants);
  return (
    <div className="flex flex-col gap-4">
      {verdict ? (
        <Callout tone={verdictTone(verdict)} title="¿Cuál variante convierte mejor?">
          <p className="text-base">{verdictText(verdict)}</p>
          {comparison ? (
            <p className="mt-2 text-xs text-muted">
              {comparison.treatment} − {comparison.control} = {formatPp(comparison.difference)} · IC 95 %{" "}
              {formatPpRange(comparison.differenceCI95)} · {formatP(comparison.test?.p ?? null)} · α = 0,05, dos colas ·
              mínimo {verdict.minPerArm} usuarios por variante
            </p>
          ) : null}
        </Callout>
      ) : (
        <Callout tone="neutral" title="¿Cuál variante convierte mejor?">
          El experimento tiene una sola variante; no hay comparación posible.
        </Callout>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {names.map((v) => (
          <Stat
            key={v}
            label={label(v)}
            value={formatPct(variants[v].rate)}
            sub={`${formatInt(variants[v].activated)} / ${formatInt(variants[v].users)} activados · IC 95 % ${formatPctRange(variants[v].rateCI95)}`}
          />
        ))}
      </div>

      <DataTable
        columns={[
          { header: "Variante" },
          { header: "Usuarios", align: "right" },
          { header: "Activados", align: "right" },
          { header: "Tasa", align: "right" },
          { header: "IC 95 %", align: "right" },
        ]}
        rows={names.map((v) => [
          label(v),
          formatInt(variants[v].users),
          formatInt(variants[v].activated),
          formatPct(variants[v].rate),
          formatPctRange(variants[v].rateCI95),
        ])}
      />

      <CIBar rows={names.map((v) => ({ label: v, rate: variants[v].rate, ci: variants[v].rateCI95 }))} />

      <p className="text-sm leading-relaxed text-muted">{ACTIVATION_DEFINITION}</p>
    </div>
  );
}
