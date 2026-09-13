import { DataTable } from "@/components/ui/DataTable";
import { CLIENT_DATA_UNAVAILABLE } from "@/content/copy";
import type { Variant } from "@/domain/experiment";
import type { Proportion } from "@/domain/stats";
import { formatDays, formatHours, formatInt, formatRatio, formatUsd } from "@/lib/format";
import type { ClientFunnelStats, GroupStats } from "@/services/experimentResults";

const ratio = (p: Proportion | null) => (p === null ? "—" : formatRatio(p.k, p.n));

interface MechanismProps {
  variants: Record<Variant, GroupStats>;
  baseline: GroupStats;
  client: ClientFunnelStats | null;
}

/** Did B work as designed? If these rows do not move, an activation change came from elsewhere. */
export function MechanismTable({ variants, baseline, client }: MechanismProps) {
  const names = Object.keys(variants);
  const perVariant = (pick: (g: GroupStats) => string) => names.map((v) => pick(variants[v]));
  const clientRow = (label: string, pick: (c: ClientFunnelStats, v: string) => string) => [
    label,
    ...names.map((v) => (client ? pick(client, v) : CLIENT_DATA_UNAVAILABLE)),
    "—",
  ];

  return (
    <DataTable
      columns={[{ header: "Mecanismo" }, ...names.map((v) => ({ header: v, align: "right" as const })), { header: "línea base", align: "right" }]}
      rows={[
        ["1er depósito vía el método recomendado para el país", ...perVariant((g) => ratio(g.usedRecommended)), ratio(baseline.usedRecommended)],
        ["Inició un depósito ≤ 168 h", ...perVariant((g) => formatRatio(g.initiatedInWindow, g.users)), formatRatio(baseline.initiatedInWindow, baseline.users)],
        ["Mediana registro → inicio del depósito", ...perVariant((g) => formatDays(g.medianDaysToInitiate)), formatDays(baseline.medianDaysToInitiate)],
        ["Mediana inicio → acreditación", ...perVariant((g) => formatHours(g.medianHoursToCredit)), formatHours(baseline.medianHoursToCredit)],
        clientRow("Vio la pantalla (evento de cliente)", (c, v) => formatInt(c.exposed[v] ?? 0)),
        clientRow("Abrió «ver otras opciones»", (c, v) => formatInt(c.expanded[v] ?? 0)),
        clientRow("Eligió el método recomendado en pantalla", (c, v) => `${formatInt(c.selectedRecommended[v] ?? 0)} / ${formatInt(c.selected[v] ?? 0)}`),
      ]}
      caption="Filas de tiempo y método: entre usuarios que acreditaron alguna vez. Filas de pantalla: usuarios únicos con eventos de cliente."
    />
  );
}

interface GuardrailsProps {
  variants: Record<Variant, GroupStats>;
}

/** Things B could quietly break. */
export function GuardrailsTable({ variants }: GuardrailsProps) {
  const names = Object.keys(variants);
  const perVariant = (pick: (g: GroupStats) => string) => names.map((v) => pick(variants[v]));
  return (
    <DataTable
      columns={[{ header: "Guardrail" }, ...names.map((v) => ({ header: v, align: "right" as const }))]}
      rows={[
        ["Tasa de fallo (fallidos / finalizados)", ...perVariant((g) => (g.failureRate ? `${formatRatio(g.failureRate.k, g.failureRate.n)}` : "—"))],
        ["Monto mediano del 1er depósito", ...perVariant((g) => formatUsd(g.medianFirstDepositUsd))],
        ["Acreditaron después de la ventana", ...perVariant((g) => formatInt(g.lateConversions))],
        ["Depositaron alguna vez", ...perVariant((g) => formatRatio(g.everConverted, g.users))],
      ]}
      caption="Tasa de fallo sobre depósitos informados por webhook. Una diferencia de activación con peor fallo o menor monto es otra conversación."
    />
  );
}
