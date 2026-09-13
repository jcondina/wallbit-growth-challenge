import { connection } from "next/server";
import { Simulator } from "@/components/simulate/Simulator";
import { Callout } from "@/components/ui/Callout";
import { Page } from "@/components/ui/Page";
import { FUNDING_EXPERIMENT, isEligible } from "@/domain/experiment";
import { getDb } from "@/infra/db";
import { getAssignment } from "@/infra/repos/assignments";
import { getExperiment } from "@/infra/repos/experiments";
import { listUsers } from "@/infra/repos/users";
import { simulatedCounts } from "@/services/simulateJourney";

export const metadata = { title: "Simulador · Wallbit experimento" };

// /simulate — generate user journeys through the app's own write paths and
// watch /funnel and /results react. Everything it writes is tagged and
// removable from this same page.
export default async function SimulatePage() {
  await connection();
  const db = getDb();
  const experiment = getExperiment(db, FUNDING_EXPERIMENT.id);
  if (!experiment) {
    return (
      <Page title="Simulador" width="narrow">
        <Callout tone="warning">No hay experimento cargado. Corré <span className="font-mono">npm run seed</span>.</Callout>
      </Page>
    );
  }

  const users = listUsers(db);
  const eligible = users.filter((u) => isEligible(experiment, u));
  const samples = [...Map.groupBy(eligible, (u) => u.country).values()]
    .map((group) => group[0])
    .map((u) => ({ id: u.id, country: u.country, variant: getAssignment(db, experiment.id, u.id)?.variant ?? null }));

  return (
    <Page
      title="Simulador de recorridos"
      subtitle="Genera lo que el simulador del proveedor no puede: usuarios que abren la pantalla, eligen, copian, transfieren. Todo entra por los mismos servicios que el tráfico real y se puede borrar de un botón."
    >
      <Simulator samples={samples} counts={simulatedCounts(db)} />
    </Page>
  );
}
