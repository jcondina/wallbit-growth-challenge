import Link from "next/link";
import { connection } from "next/server";
import { StatusSwitch } from "@/components/admin/StatusSwitch";
import { Callout } from "@/components/ui/Callout";
import { Card } from "@/components/ui/Card";
import { Page } from "@/components/ui/Page";
import { Pill } from "@/components/ui/Pill";
import { FUNDING_EXPERIMENT } from "@/domain/experiment";
import { getDb } from "@/infra/db";
import { getExperiment } from "@/infra/repos/experiments";
import { formatUtc } from "@/lib/format";

export const metadata = { title: "Admin · Wallbit experimento" };

export default async function AdminPage() {
  await connection();
  const e = getExperiment(getDb(), FUNDING_EXPERIMENT.id);
  if (!e) {
    return (
      <Page title="Admin" width="narrow">
        <Callout tone="warning">No hay experimento cargado. Corré <span className="font-mono">npm run seed</span>.</Callout>
      </Page>
    );
  }

  return (
    <Page title="Kill switch" width="narrow" subtitle="Frena el experimento sin deploy. Sin autenticación: es un stub del ejercicio.">
      <Card>
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="font-mono text-xs text-muted">{e.id}</div>
            <div className="mt-1 font-semibold">{e.name}</div>
          </div>
          {e.status === "running" ? <Pill tone="success">● Corriendo</Pill> : e.status === "paused" ? <Pill tone="warning">⏸ Pausado</Pill> : <Pill>■ Finalizado</Pill>}
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
          <dt className="text-muted">Asignación</dt>
          <dd>{e.allocation.map((a) => `${a.variant} ${a.weight} %`).join(" · ")} (v{e.allocationVersion})</dd>
          <dt className="text-muted">Ventana</dt>
          <dd>{e.windowHours} h desde el registro</dd>
          <dt className="text-muted">Pausado el</dt>
          <dd>{formatUtc(e.pausedAt)}</dd>
        </dl>
        <div className="mt-5">
          <StatusSwitch experimentId={e.id} status={e.status} />
        </div>
      </Card>
      <Callout tone="neutral" title="Qué pasa al pausar">
        Desde la siguiente request todos los usuarios ven la variante A y no se asignan usuarios nuevos. Las asignaciones
        existentes no se tocan: <Link href="/results" prefetch={false} className="underline">/results</Link> sigue
        reportando la cohorte congelada y muestra el aviso. Reanudar restaura las variantes asignadas.
      </Callout>
    </Page>
  );
}
