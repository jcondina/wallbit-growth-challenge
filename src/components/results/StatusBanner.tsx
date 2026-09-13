import { Pill } from "@/components/ui/Pill";
import type { Experiment } from "@/domain/experiment";
import type { Instant } from "@/domain/time";
import { formatInt, formatUtc } from "@/lib/format";

interface Props {
  experiment: Experiment;
  usersAssigned: number;
  dataThrough: Instant | null;
  asOf: Instant;
  windowsClosed: number;
  windowsPending: number;
  simulatedDeposits: number;
}

/** First line of the page: what experiment, what state, how fresh, how complete. */
export function StatusBanner({ experiment, usersAssigned, dataThrough, asOf, windowsClosed, windowsPending, simulatedDeposits }: Props) {
  const status =
    experiment.status === "running" ? (
      <Pill tone="success">● Corriendo</Pill>
    ) : experiment.status === "paused" ? (
      <Pill tone="warning">⏸ Pausado el {formatUtc(experiment.pausedAt)}</Pill>
    ) : (
      <Pill tone="neutral">■ Finalizado</Pill>
    );

  return (
    <div className="rounded-[var(--radius-card)] border border-line bg-surface px-5 py-4 text-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="font-mono text-xs text-muted">{experiment.id}</span>
        {status}
        {simulatedDeposits > 0 ? (
          <Pill tone="warning">
            incluye {formatInt(simulatedDeposits)} depósito{simulatedDeposits === 1 ? "" : "s"} simulado{simulatedDeposits === 1 ? "" : "s"}
          </Pill>
        ) : null}
        <span className="text-muted">·</span>
        <span>
          Cohorte: registrados desde <span className="font-mono">{formatUtc(experiment.startsAt)}</span> ·{" "}
          {formatInt(usersAssigned)} usuarios asignados
        </span>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-muted">
        <span>
          Datos hasta <span className="font-mono">{formatUtc(dataThrough)}</span>
        </span>
        <span>·</span>
        <span>
          Ventanas cerradas: {formatInt(windowsClosed)} / {formatInt(windowsClosed + windowsPending)}
          {windowsPending > 0 ? ` (${formatInt(windowsPending)} pendientes)` : ""}
        </span>
        <span>·</span>
        <span>
          Calculado el <span className="font-mono">{formatUtc(asOf)}</span>
        </span>
      </div>
    </div>
  );
}
