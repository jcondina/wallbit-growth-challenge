import Link from "next/link";
import { connection } from "next/server";
import { BaselineCard } from "@/components/results/BaselineCard";
import { CountryTable } from "@/components/results/CountryTable";
import { DataQualityTable } from "@/components/results/DataQualityTable";
import { GuardrailsTable, MechanismTable } from "@/components/results/MetricTables";
import { PowerTable } from "@/components/results/PowerTable";
import { StatusBanner } from "@/components/results/StatusBanner";
import { VerdictBlock } from "@/components/results/VerdictBlock";
import { Disclosure } from "@/components/ui/Disclosure";
import { Page } from "@/components/ui/Page";
import { Section } from "@/components/ui/Section";
import { CONTROL_VARIANT } from "@/domain/experiment";
import { getDb } from "@/infra/db";
import { experimentResults } from "@/services/experimentResults";

export const metadata = { title: "Resultados · Wallbit experimento" };

// /results — the Growth readout. Order: verdict → numbers → definition →
// baseline as context → mechanism → guardrails → collapsed reference material.
export default async function ResultsPage() {
  await connection(); // synchronous SQLite reads must never be prerendered
  const r = experimentResults(getDb());
  const groups = Object.values(r.variants);
  const pending = groups.reduce((acc, g) => acc + g.pendingWindows, 0);
  const assigned = groups.reduce((acc, g) => acc + g.users, 0);

  return (
    <Page
      title="Resultado del experimento"
      subtitle={
        <>
          {r.experiment.name}. Ver también el{" "}
          <Link href="/funnel" prefetch={false} className="underline">
            embudo
          </Link>{" "}
          y el{" "}
          <Link href="/api/results" prefetch={false} className="underline">
            JSON
          </Link>
          .
        </>
      }
    >
      <StatusBanner
        experiment={r.experiment}
        usersAssigned={assigned}
        dataThrough={r.dataThrough}
        asOf={r.asOf}
        windowsClosed={assigned - pending}
        windowsPending={pending}
      />

      <VerdictBlock variants={r.variants} comparison={r.comparison} verdict={r.verdict} />

      <Section title="Línea base — contexto, no comparación">
        <BaselineCard baseline={r.baseline} controlRate={r.variants[CONTROL_VARIANT]?.rate ?? null} sanity={r.sanity} />
      </Section>

      <Section title="¿Funcionó B como se diseñó?" description="Si B no mueve la primera fila, cualquier cambio en activación vino de otro lado.">
        <MechanismTable variants={r.variants} baseline={r.baseline} client={r.client} />
      </Section>

      <Section title="Guardrails — B no debería empeorar esto">
        <GuardrailsTable variants={r.variants} />
      </Section>

      <Disclosure summary={`Corte por país (${r.byCountry.length} países, muestras chicas — abrir con cuidado)`}>
        <CountryTable cuts={r.byCountry} />
      </Disclosure>

      <Disclosure summary={`Calidad de datos · ${r.dataQuality.inbox.deliveries} webhooks · ${r.dataQuality.inbox.uniqueEvents} únicos · ${r.dataQuality.deposits.total} depósitos`}>
        <DataQualityTable dq={r.dataQuality} />
      </Disclosure>

      <Disclosure summary="Potencia — qué puede detectar este experimento">
        <PowerTable power={r.power} />
      </Disclosure>
    </Page>
  );
}
