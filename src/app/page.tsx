import Link from "next/link";
import { connection } from "next/server";
import { Card } from "@/components/ui/Card";
import { DataTable } from "@/components/ui/DataTable";
import { Pill } from "@/components/ui/Pill";
import { Section } from "@/components/ui/Section";
import { countryName, flagEmoji } from "@/content/copy";
import { verdictText } from "@/content/verdict";
import { FUNDING_EXPERIMENT, isEligible } from "@/domain/experiment";
import { getDb } from "@/infra/db";
import { getAssignment } from "@/infra/repos/assignments";
import { getExperiment } from "@/infra/repos/experiments";
import { listUsers } from "@/infra/repos/users";
import { formatInt, formatPct, formatUtc } from "@/lib/format";
import { experimentResults } from "@/services/experimentResults";
import { funnelResults } from "@/services/funnelResults";

// / — the landing page: what this is, what it tries to find out, and the
// four things a visitor can do. Numbers are live from the database.
export default async function Home() {
  await connection();
  const db = getDb();
  const experiment = getExperiment(db, FUNDING_EXPERIMENT.id);
  const users = listUsers(db);

  if (!experiment || users.length === 0) {
    return (
      <main className="mx-auto w-full max-w-[880px] px-5 py-10">
        <Card>
          Base vacía. Corré <span className="font-mono">npm run seed</span> y recargá.
        </Card>
      </main>
    );
  }

  const results = experimentResults(db);
  const funnel = funnelResults(db);
  const A = results.variants.A;
  const B = results.variants.B;
  const eligible = users.filter((u) => isEligible(experiment, u));
  const firstPerCountry = [...Map.groupBy(eligible, (u) => u.country).values()].map((group) => group[0]);
  const preExperiment = users.find((u) => !isEligible(experiment, u));
  const samples = [...firstPerCountry, ...(preExperiment ? [preExperiment] : [])];

  const link = (href: string, label: string) => (
    <Link href={href} prefetch={false} className="underline">
      {label}
    </Link>
  );

  return (
    <main className="mx-auto w-full max-w-[880px] px-5 py-10">
      {/* ---- hero: the question, and the live answer ------------------------ */}
      <header className="mb-12">
        <p className="mb-3 font-mono text-xs text-muted">Wallbit · Growth · experimento {experiment.id}</p>
        <h1 className="max-w-[26ch] text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
          ¿Convierte más un solo método recomendado que la lista completa?
        </h1>
        <p className="mt-4 max-w-[62ch] text-base text-muted">
          Un tercio de la gente que se registra en Wallbit ingresa dinero en la primera semana. El resto crea la cuenta y
          nunca la fondea. Sospechamos que la pantalla de ingreso, con nueve métodos a la vez, les pide autodiagnosticarse
          en el peor momento. Esta app corre el experimento que lo pone a prueba y lee el resultado sin engañar a nadie.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/results" prefetch={false} className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90">
            Ver el resultado
          </Link>
          <Link href="/simulate" prefetch={false} className="rounded-md border border-line bg-surface px-4 py-2 text-sm font-medium hover:bg-surface-muted">
            Probar el embudo con usuarios simulados
          </Link>
        </div>
      </header>

      {/* ---- live numbers ---------------------------------------------------- */}
      <div className="mb-12 grid gap-3 sm:grid-cols-4">
        <Stat label="A · lista completa" value={formatPct(A.rate)} sub={`${formatInt(A.activated)} / ${formatInt(A.users)} activados`} />
        <Stat label="B · método recomendado" value={formatPct(B.rate)} sub={`${formatInt(B.activated)} / ${formatInt(B.users)} activados`} />
        <Stat label="Usuarios en el experimento" value={formatInt(A.users + B.users)} sub="asignados al registrarse" />
        <Stat label="Abrieron la pantalla" value={formatInt(funnel.exposedUsers)} sub={funnel.exposedUsers === 0 ? "todavía nadie: probá una" : "en el embudo"} />
      </div>
      {results.verdict ? (
        <p className="mb-12 rounded-[var(--radius-card)] border border-line bg-surface-muted px-5 py-4 text-sm">
          <span className="mr-2 font-semibold">Hoy dice:</span>
          {verdictText(results.verdict)}{" "}
          {experiment.status === "running" ? <Pill tone="success">● corriendo</Pill> : <Pill tone="warning">⏸ pausado</Pill>}
        </p>
      ) : null}

      <div className="flex flex-col gap-14">
      {/* ---- the hypothesis, in two screens --------------------------------- */}
      <Section title="La hipótesis, en dos pantallas" description="Cada usuario nuevo cae en una de las dos al azar, y ahí se queda.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <div className="mb-2 flex items-center gap-2">
              <Pill>A · control</Pill>
              <span className="text-sm font-semibold">La lista completa, como hoy</span>
            </div>
            <p className="text-sm text-muted">
              Transferencia local, wire, SEPA, USDT, USDC, PayPal, Wise, Payoneer: todos los métodos elegibles para su país,
              en tarjetas iguales. El usuario elige.
            </p>
          </Card>
          <Card emphasis="accent">
            <div className="mb-2 flex items-center gap-2">
              <Pill tone="accent">B · recomendado</Pill>
              <span className="text-sm font-semibold">Un método según el país</span>
            </div>
            <p className="text-sm text-muted">
              La transferencia local del país (SEPA en España, wire donde no hay rail local) destacada, con los datos a un
              toque. El resto sigue ahí, detrás de «ver otras opciones».
            </p>
          </Card>
        </div>
      </Section>

      {/* ---- what you can do here -------------------------------------------- */}
      <Section title="Qué podés hacer acá" description="Cuatro lugares, un mismo dato de fondo: todo lee la misma base.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Action href={`/u/${samples[0]?.id ?? "usr_000871"}/fund`} title="Abrir la pantalla como un usuario" cta="Entrar como usuario">
            Ves exactamente lo que ve ese usuario: su variante, su país, sus métodos. Con <span className="font-mono">?preview=A|B</span> ves la otra sin
            registrar nada.
          </Action>
          <Action href="/results" title="Leer el resultado" cta="Ver resultados">
            Qué variante convierte mejor, con intervalos, la definición exacta de «activado», la línea base y qué tamaño de efecto
            podía detectar el experimento.
          </Action>
          <Action href="/funnel" title="Ver dónde se traba la gente" cta="Ver embudo">
            Vio → eligió → copió → depósito detectado → acreditado, por variante y por método, con señales de fricción. Se
            actualiza solo.
          </Action>
          <Action href="/simulate" title="Generar tráfico y mirar cómo reacciona" cta="Abrir simulador">
            Usuarios que miran, eligen, copian, transfieren o fallan, por los mismos caminos que el tráfico real. Se borra de un
            botón y los tableros vuelven a lo que eran.
          </Action>
        </div>
      </Section>

      {/* ---- how it works ---------------------------------------------------- */}
      <Section title="Cómo funciona" description="Cinco pasos, del registro al tablero.">
        <ol className="grid gap-3 text-sm sm:grid-cols-5">
          {[
            ["Registro", "Cada usuario elegible cae en A o B por un hash de su id, y queda guardado."],
            ["Pantalla", "Se renderiza su variante y se registra qué hace: ve, elige, copia, se va."],
            ["Banco", "Transfiere desde su banco o wallet. Acá la app no ve nada."],
            ["Webhook", "El proveedor avisa: detectado, acreditado o fallido. Puede repetir, reordenar, reenviar: da igual."],
            ["Resultado", "Activado = acreditado dentro de las 168 h del registro. Una sola definición para todo."],
          ].map(([title, body], i) => (
            <li key={title} className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
              <div className="mb-1 font-mono text-xs text-muted">{i + 1}</div>
              <div className="font-semibold">{title}</div>
              <p className="mt-1 text-muted">{body}</p>
            </li>
          ))}
        </ol>
      </Section>

      {/* ---- start here: sample users ---------------------------------------- */}
      <Section
        title="Empezá por acá: usuarios de muestra"
        description="El primer registro elegible de cada país, más uno anterior al experimento (ve la lista completa y no cuenta). «abrir» registra eventos de verdad; «preview» no."
      >
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
          Sin login por diseño: la URL dice quién es el usuario. Para pausar el experimento sin deploy, {link("/admin", "kill switch")}.
        </p>
      </Section>
      </div>
    </main>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold tracking-tight">{value}</div>
      <div className="text-xs text-muted">{sub}</div>
    </div>
  );
}

function Action({ href, title, cta, children }: { href: string; title: string; cta: string; children: React.ReactNode }) {
  return (
    <Card className="flex flex-col">
      <div className="font-semibold">{title}</div>
      <p className="mt-1 flex-1 text-sm text-muted">{children}</p>
      <Link href={href} prefetch={false} className="mt-4 inline-flex w-fit rounded-md border border-line bg-surface-muted px-3 py-1.5 text-sm font-medium hover:bg-line">
        {cta} →
      </Link>
    </Card>
  );
}
