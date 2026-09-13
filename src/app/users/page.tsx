import Link from "next/link";
import { connection } from "next/server";
import { Callout } from "@/components/ui/Callout";
import { Card } from "@/components/ui/Card";
import { DataTable } from "@/components/ui/DataTable";
import { Page } from "@/components/ui/Page";
import { Pill } from "@/components/ui/Pill";
import { Section } from "@/components/ui/Section";
import { OpenUserForm } from "@/components/users/OpenUserForm";
import { countryName, flagEmoji } from "@/content/copy";
import { FUNDING_EXPERIMENT, isEligible } from "@/domain/experiment";
import { getDb } from "@/infra/db";
import { countAssignmentsByVariant, getAssignment } from "@/infra/repos/assignments";
import { getExperiment } from "@/infra/repos/experiments";
import { listUsers } from "@/infra/repos/users";
import { formatInt, formatUtc } from "@/lib/format";

export const metadata = { title: "Usuarios · Wallbit experimento" };

// /users — the door into the funding screen: sample users, one per country,
// plus a box to open any id. No login by design (the brief).
export default async function UsersPage() {
  await connection();
  const db = getDb();
  const experiment = getExperiment(db, FUNDING_EXPERIMENT.id);
  const users = listUsers(db);

  if (!experiment || users.length === 0) {
    return (
      <Page title="Usuarios" width="narrow">
        <Callout tone="warning">Base vacía. Corré <span className="font-mono">npm run seed</span> y recargá.</Callout>
      </Page>
    );
  }

  const eligible = users.filter((u) => isEligible(experiment, u));
  const firstPerCountry = [...Map.groupBy(eligible, (u) => u.country).values()].map((group) => group[0]);
  const preExperiment = users.find((u) => !isEligible(experiment, u));
  const samples = [...firstPerCountry, ...(preExperiment ? [preExperiment] : [])];
  const byVariant = countAssignmentsByVariant(db, experiment.id);

  const link = (href: string, label: string) => (
    <Link href={href} prefetch={false} className="underline">
      {label}
    </Link>
  );

  return (
    <Page
      title="Usuarios"
      subtitle={
        <>
          {formatInt(users.length)} usuarios en la base: {formatInt(eligible.length)} elegibles (registrados desde el 1 de agosto, asignados{" "}
          {Object.entries(byVariant)
            .map(([v, n]) => `${v} ${formatInt(n)}`)
            .join(" · ")}
          ) y {formatInt(users.length - eligible.length)} anteriores al experimento, que ven la lista completa y no cuentan.
        </>
      }
    >
      <Section title="Abrir cualquier usuario" description="Sin login por diseño: la URL dice quién es. «Abrir» registra eventos de verdad; «preview» muestra una variante sin asignar ni registrar nada.">
        <Card>
          <OpenUserForm />
        </Card>
      </Section>

      <Section title="Usuarios de muestra" description="El primer registro elegible de cada país, más uno anterior al experimento.">
        <DataTable
          columns={[{ header: "Usuario" }, { header: "País" }, { header: "Registro" }, { header: "Variante" }, { header: "Pantalla" }]}
          rows={samples.map((u) => {
            const a = getAssignment(db, experiment.id, u.id);
            const eligibleUser = isEligible(experiment, u);
            return [
              <span key="id" className="font-mono text-xs">{u.id}</span>,
              `${flagEmoji(u.country)} ${countryName(u.country)}`,
              <span key="t" className="text-muted">{formatUtc(u.createdAt)}</span>,
              a ? <Pill tone={a.variant === "B" ? "accent" : "neutral"}>{a.variant}</Pill> : eligibleUser ? <Pill tone="warning">sin asignar</Pill> : <Pill>no elegible</Pill>,
              <span key="l" className="flex flex-wrap gap-3">
                {link(`/u/${u.id}/fund`, "abrir")}
                <span className="text-muted">
                  preview {link(`/u/${u.id}/fund?preview=A`, "A")} · {link(`/u/${u.id}/fund?preview=B`, "B")}
                </span>
              </span>,
            ];
          })}
        />
        <p className="text-xs text-muted">
          Para generar recorridos completos sin hacer click uno por uno, {link("/simulate", "el simulador")}. Para pausar el experimento sin deploy,{" "}
          {link("/admin", "el kill switch")}.
        </p>
      </Section>
    </Page>
  );
}
