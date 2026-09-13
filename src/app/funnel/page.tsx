import { connection } from "next/server";
import { AutoRefresh } from "@/components/funnel/AutoRefresh";
import { Callout } from "@/components/ui/Callout";
import { DataTable } from "@/components/ui/DataTable";
import { Page } from "@/components/ui/Page";
import { Pill } from "@/components/ui/Pill";
import { Section } from "@/components/ui/Section";
import { CLIENT_DATA_UNAVAILABLE } from "@/content/copy";
import { STEPS, type Step, type VariantFunnel } from "@/domain/funnel";
import { getDb } from "@/infra/db";
import { formatInt, formatPct, formatUtc } from "@/lib/format";
import { funnelResults } from "@/services/funnelResults";

export const metadata = { title: "Embudo · Wallbit experimento" };

const STEP_LABEL: Record<Step, string> = {
  viewed: "Vio la pantalla",
  selected: "Eligió un método",
  copied: "Copió los datos",
  received: "Depósito detectado",
  completed: "Depósito acreditado",
};

const seconds = (ms: number | null) =>
  ms === null ? "—" : `${(ms / 1000).toLocaleString("es-AR", { maximumFractionDigits: 1 })} s`;

function dropSentence(v: VariantFunnel): string {
  if (v.steps.viewed === 0) return `Variante ${v.variant}: ${CLIENT_DATA_UNAVAILABLE}.`;
  if (!v.largestDrop) return `Variante ${v.variant}: sin pérdidas entre pasos todavía.`;
  const d = v.largestDrop;
  return (
    `Variante ${v.variant} — mayor pérdida: ${STEP_LABEL[d.from].toLowerCase()} → ${STEP_LABEL[d.to].toLowerCase()} ` +
    `(−${formatPct(d.rate, 0)}, ${formatInt(d.users)} usuario${d.users === 1 ? "" : "s"}).`
  );
}

export default async function FunnelPage() {
  await connection(); // synchronous SQLite reads must never be prerendered
  const r = funnelResults(getDb());
  const variants = r.byVariant.map((v) => v.variant);
  const noClientData = r.exposedUsers === 0;
  const right = "right" as const;

  const stepRows = STEPS.map((step) => [
    STEP_LABEL[step],
    ...r.byVariant.flatMap((v) => {
      const conv = step === "viewed" ? null : v.conversion[step];
      return [formatInt(v.steps[step]), conv === null ? "—" : formatPct(conv, 0)];
    }),
  ]);

  return (
    <Page
      title="¿Dónde se traba la gente?"
      subtitle={
        <>
          Usuarios únicos por paso, solo entre los {formatInt(r.exposedUsers)} usuarios del experimento que abrieron la
          pantalla instrumentada ({formatInt(r.enrolledUsers)} asignados). Los pasos de depósito vienen de los webhooks
          del proveedor.
        </>
      }
    >
      <AutoRefresh seconds={5} />

      {noClientData ? (
        <Callout tone="neutral" title="Todavía no hay eventos de pantalla">
          El simulador del proveedor solo emite webhooks: los pasos de pantalla se llenan cuando alguien abre{" "}
          <span className="font-mono">/u/&lt;usuario&gt;/fund</span> en la app. Esta página se actualiza sola cada 5
          segundos.
        </Callout>
      ) : null}

      <Section title="Embudo por variante" description={r.byVariant.map(dropSentence).join(" ")}>
        <DataTable
          columns={[
            { header: "Paso" },
            ...variants.flatMap((v) => [
              { header: `${v} · usuarios`, align: right },
              { header: `${v} · conv.`, align: right },
            ]),
          ]}
          rows={stepRows}
          caption="conv. = usuarios del paso ÷ usuarios del paso anterior. Los fallidos se muestran aparte abajo."
        />
        <DataTable
          columns={[{ header: "Señal" }, ...variants.map((v) => ({ header: v, align: right }))]}
          rows={[
            ["Depósito fallido (usuarios)", ...r.byVariant.map((v) => formatInt(v.steps.failed))],
            ["Mediana hasta elegir un método", ...r.byVariant.map((v) => seconds(v.medianMsToSelect))],
            ["Mediana de elegir a copiar", ...r.byVariant.map((v) => seconds(v.medianMsToCopy))],
          ]}
        />
      </Section>

      <Section
        title="¿Funcionó B como se diseñó?"
        description="Si B no mueve estas dos filas, cualquier cambio en activación vino de otro lado."
      >
        <DataTable
          columns={[{ header: "Mecanismo" }, ...variants.map((v) => ({ header: v, align: right }))]}
          rows={[
            [
              "Eligió primero el método recomendado",
              ...r.byVariant.map((v) =>
                v.steps.selected === 0 ? "—" : `${formatInt(v.selectedRecommendedFirst)} / ${formatInt(v.steps.selected)}`,
              ),
            ],
            [
              'Abrió "ver otras opciones"',
              ...r.byVariant.map((v) => (v.steps.viewed === 0 ? "—" : `${formatInt(v.expanded)} / ${formatInt(v.steps.viewed)}`)),
            ],
          ]}
        />
      </Section>

      <Section
        title="Por método"
        description="Entre usuarios expuestos. Instrucciones que asustan se ven en elegir → copiar; fricción bancaria en copiar → detectado; fallas después de enviar en detectado → fallido."
      >
        {r.byMethod.length === 0 ? (
          <p className="text-sm text-muted">{CLIENT_DATA_UNAVAILABLE}</p>
        ) : (
          <DataTable
            columns={[
              { header: "Método" },
              { header: "Eligió", align: right },
              { header: "Copió", align: right },
              { header: "Detectado", align: right },
              { header: "Acreditado", align: right },
              { header: "Fallido", align: right },
            ]}
            rows={r.byMethod.map((m) => [
              <span key={m.methodId} className="font-mono">
                {m.methodId}
              </span>,
              formatInt(m.selected),
              formatInt(m.copied),
              formatInt(m.received),
              formatInt(m.completed),
              formatInt(m.failed),
            ])}
          />
        )}
      </Section>

      <Section title="Señales de fricción">
        <DataTable
          columns={[{ header: "Señal" }, { header: "Usuarios", align: right }, { header: "Cómo se lee" }]}
          rows={[
            ["Indecisión: probó 2 métodos", formatInt(r.friction.indecision.two), "eligió dos métodos distintos antes de irse"],
            ["Indecisión: probó 3 o más", formatInt(r.friction.indecision.threePlus), "la pantalla no le resolvió la elección"],
            ["Vuelve sin depositar", formatInt(r.friction.loopers), "≥ 2 visitas a la pantalla y ningún depósito detectado"],
            ["Se fue sin elegir", formatInt(r.friction.abandonedAt.viewed), "último paso al salir: vio (señal de mínimo, no todos los cierres se registran)"],
            ["Se fue después de elegir", formatInt(r.friction.abandonedAt.selected), "vio los datos y no los copió"],
            ["Se fue después de copiar", formatInt(r.friction.abandonedAt.copied), "lo esperable: salió a transferir"],
            ["Depositó por otro método", formatInt(r.friction.selectedNotDeposited), "el método del depósito no es el último que eligió en la app"],
            ["Depositó sin exposición registrada", formatInt(r.friction.unexposedDepositors), "asignados con webhooks pero sin vista de pantalla (todo el mes simulado)"],
            ["Variante mostrada ≠ asignada", formatInt(r.variantMismatches), "eventos de pantalla con otra variante (experimento pausado, o un error)"],
          ]}
        />
      </Section>

      <Section
        title="Últimos eventos"
        description="Los 20 más recientes por hora de registro. Abrí una pantalla de ingreso en otra pestaña y mirá cómo aparecen."
      >
        <div className="overflow-x-auto rounded-[var(--radius-card)] border border-line bg-surface">
          <ul className="divide-y divide-line font-mono text-xs">
            {r.recent.map((e) => (
              <li key={e.eventId} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
                <span className="text-muted">{formatUtc(e.recordedAt)}</span>
                <Pill tone={e.source === "client" ? "accent" : e.source === "webhook" ? "success" : "neutral"}>{e.source}</Pill>
                <span className="font-semibold">{e.name}</span>
                <span className="text-muted">{e.userId}</span>
                {e.variantShown ? <span>· {e.variantShown}</span> : null}
                <span className="truncate text-muted" title={JSON.stringify(e.props)}>
                  {summarizeProps(e.props)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </Section>
    </Page>
  );
}

const SHOWN_PROPS = ["method_id", "field", "via", "last_step", "deposit_id", "n_visible", "ms_since_view", "ms_on_screen", "variant"];

function summarizeProps(props: Record<string, unknown>): string {
  return Object.entries(props)
    .filter(([k]) => SHOWN_PROPS.includes(k))
    .map(([k, v]) => `${k}=${String(v)}`)
    .join(" ");
}
