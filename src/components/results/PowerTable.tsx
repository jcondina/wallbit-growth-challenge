import { DataTable } from "@/components/ui/DataTable";
import { formatInt, formatPct, formatPp } from "@/lib/format";
import type { PowerAnalysis } from "@/services/experimentResults";

const months = (m: number | null) => (m === null ? "—" : m < 1 ? `${(m * 30).toFixed(0)} días` : `${m.toLocaleString("es-AR", { maximumFractionDigits: 1 })} meses`);

/** What this experiment could have seen, and what a given lift would need. */
export function PowerTable({ power }: { power: PowerAnalysis }) {
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p>
        Con los tamaños actuales y una tasa base de {formatPct(power.baseRate)}, el experimento detecta efectos de al menos{" "}
        <strong>{formatPp(power.mde).replace("+", "")}</strong> (α = 0,05, potencia 80 %). Un resultado «no detectable» no es «sin efecto»: es «sin efecto de ese tamaño».
      </p>
      <DataTable
        columns={[{ header: "Efecto a detectar" }, { header: "Usuarios necesarios", align: "right" }, { header: "Al ritmo observado", align: "right" }]}
        rows={power.table.map((t) => [formatPp(t.lift), t.usersNeeded === null ? "—" : formatInt(t.usersNeeded), months(t.months)])}
        caption={`Ritmo observado: ${power.signupsPerMonthObserved === null ? "—" : formatInt(Math.round(power.signupsPerMonthObserved))} registros elegibles por mes en la cohorte.`}
      />
      {power.probabilityTreatmentBeatsControl !== null ? (
        <p className="text-muted">
          P(B &gt; A) ≈ <strong>{formatPct(power.probabilityTreatmentBeatsControl, 0)}</strong> — posteriores Beta(1+k, 1+n−k) con priors uniformes, aproximación normal.
          Misma información que el intervalo de confianza, otra lectura.
        </p>
      ) : null}
    </div>
  );
}
