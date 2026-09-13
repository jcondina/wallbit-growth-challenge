import { DataTable } from "@/components/ui/DataTable";
import { formatInt, formatUtc } from "@/lib/format";
import type { DataQuality } from "@/services/experimentResults";

/** How the at-least-once delivery was handled — replaying the simulator changes only the first row. */
export function DataQualityTable({ dq }: { dq: DataQuality }) {
  const i = dq.inbox;
  return (
    <DataTable
      columns={[{ header: "Ingesta" }, { header: "Valor", align: "right" }, { header: "Qué significa" }]}
      rows={[
        ["Webhooks recibidos", formatInt(i.deliveries), "entregas del proveedor, duplicados incluidos (sube si se vuelve a correr el simulador)"],
        ["Eventos únicos", formatInt(i.uniqueEvents), "event_id distintos"],
        ["Duplicados ignorados", formatInt(dq.duplicatesIgnored), "mismo event_id entregado más de una vez"],
        ["Reenvíos con id nuevo", formatInt(i.resends), "mismo depósito y tipo bajo otro event_id: no cambian el estado"],
        ["Depósitos", `${formatInt(dq.deposits.total)} = ${formatInt(dq.deposits.completed)} ✓ · ${formatInt(dq.deposits.failed)} ✗ · ${formatInt(dq.deposits.conflict)} conflicto · ${formatInt(dq.deposits.received)} en curso`, "estado final por deposit_id"],
        ["Depósitos simulados", formatInt(dq.simulatedDeposits), "escritos desde /simulate; se borran desde ahí"],
        ["Anomalías", formatInt(i.withAnomalies), "usuario o método desconocido, monto no positivo, depósito anterior al registro, fecha futura"],
        ["Firmas inválidas aceptadas", formatInt(i.unsigned), "solo posible con WEBHOOK_VERIFY_SIGNATURE=false"],
        ["Header ≠ body", formatInt(i.headerMismatches), "el body firmado manda"],
        ["Usuarios desconocidos", formatInt(dq.unknownUsers), "depositaron sin estar en users.json"],
        ["Depositantes sin asignación", formatInt(dq.assignmentsMissingForDepositors), "usuarios conocidos con depósito y sin variante"],
        ["Último hecho informado", formatUtc(i.lastOccurredAt), "occurred_at máximo"],
      ]}
    />
  );
}
