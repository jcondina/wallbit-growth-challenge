import Link from "next/link";
import { connection } from "next/server";
import { Card } from "@/components/ui/Card";
import { DataTable } from "@/components/ui/DataTable";
import { Page } from "@/components/ui/Page";
import { Pill } from "@/components/ui/Pill";
import { Section } from "@/components/ui/Section";
import { countryName, flagEmoji } from "@/content/copy";
import { FUNDING_EXPERIMENT, isEligible } from "@/domain/experiment";
import { getDb } from "@/infra/db";
import { getAssignment } from "@/infra/repos/assignments";
import { getExperiment } from "@/infra/repos/experiments";
import { type User, listUsers } from "@/infra/repos/users";
import { formatUtc } from "@/lib/format";

// Dev index: one sample user per country plus one pre-experiment user, so
// A, B and "no elegible" are each one click away in the walkthrough.
export default async function Home() {
  await connection();
  const db = getDb();
  const experiment = getExperiment(db, FUNDING_EXPERIMENT.id);
  const users = listUsers(db);

  if (!experiment || users.length === 0) {
    return (
      <Page title="Wallbit · Experimento de ingreso de dinero" width="narrow">
        <Card>
          Base vacía. Corré <span className="font-mono">npm run seed</span> y recargá.
        </Card>
      </Page>
    );
  }

  const firstPerCountry = new Map<string, User>();
  for (const u of users) {
    if (isEligible(experiment, u) && !firstPerCountry.has(u.country)) firstPerCountry.set(u.country, u);
  }
  const preExperiment = users.find((u) => !isEligible(experiment, u));
  const samples = [...firstPerCountry.values(), ...(preExperiment ? [preExperiment] : [])];

  const link = (href: string, label: string) => (
    <Link href={href} prefetch={false} className="underline">
      {label}
    </Link>
  );

  return (
    <Page
      title="Wallbit · Experimento de ingreso de dinero"
      subtitle="Un método recomendado por país (B) contra la lista completa (A). Elegí un usuario para ver su pantalla; los resultados y el embudo leen la misma base."
    >
      <div className="flex flex-wrap gap-3">
        {[
          ["/results", "Resultados"],
          ["/funnel", "Embudo"],
          ["/admin", "Kill switch"],
          ["/api/results", "JSON de resultados"],
        ].map(([href, label]) => (
          <Link key={href} href={href} prefetch={false} className="rounded-md border border-line bg-surface px-4 py-2 text-sm font-medium hover:bg-surface-muted">
            {label}
          </Link>
        ))}
      </div>

      <Section
        title="Usuarios de muestra"
        description="El primer registro elegible de cada país, más un usuario anterior al experimento. Los enlaces «preview» muestran una variante sin asignar ni registrar eventos."
      >
        <DataTable
          columns={[{ header: "Usuario" }, { header: "País" }, { header: "Registro" }, { header: "Variante" }, { header: "Pantalla" }]}
          rows={samples.map((u) => {
            const a = getAssignment(db, experiment.id, u.id);
            const eligible = isEligible(experiment, u);
            return [
              <span key="id" className="font-mono text-xs">{u.id}</span>,
              `${flagEmoji(u.country)} ${countryName(u.country)}`,
              <span key="t" className="text-muted">{formatUtc(u.createdAt)}</span>,
              a ? <Pill tone={a.variant === "B" ? "accent" : "neutral"}>{a.variant}</Pill> : eligible ? <Pill tone="warning">sin asignar</Pill> : <Pill>no elegible</Pill>,
              <span key="l" className="flex flex-wrap gap-3">
                {link(`/u/${u.id}/fund`, "abrir")}
                <span className="text-muted">
                  preview {link(`/u/${u.id}/fund?preview=A`, "A")} · {link(`/u/${u.id}/fund?preview=B`, "B")}
                </span>
              </span>,
            ];
          })}
        />
      </Section>
    </Page>
  );
}
