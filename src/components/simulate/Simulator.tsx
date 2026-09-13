"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Pill } from "@/components/ui/Pill";
import { JOURNEYS, JOURNEY_LABEL, type Journey } from "@/content/journeys";
import type { JourneyReport, SimulatedCounts } from "@/services/simulateJourney";

interface SampleUser {
  id: string;
  country: string;
  variant: string | null;
}

interface Props {
  samples: SampleUser[];
  counts: SimulatedCounts;
}

type Reply = { reports?: JourneyReport[]; removed?: SimulatedCounts; counts: SimulatedCounts; error?: string };

export function Simulator({ samples, counts }: Props) {
  const router = useRouter();
  const [userId, setUserId] = useState(samples[0]?.id ?? "");
  const [journey, setJourney] = useState<Journey>("deposited");
  const [users, setUsers] = useState(40);
  const [seed, setSeed] = useState(2026);
  const [busy, setBusy] = useState<string | null>(null);
  const [reply, setReply] = useState<Reply | null>(null);

  const call = async (label: string, body: unknown) => {
    setBusy(label);
    try {
      const res = await fetch("/api/simulate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const data = (await res.json()) as Reply;
      setReply(res.ok ? data : { counts, error: data.error ?? `HTTP ${res.status}` });
      router.refresh();
    } catch (e) {
      setReply({ counts, error: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  const reset = () => {
    if (window.confirm("¿Borrar todos los datos simulados? Las asignaciones no se tocan.")) void call("reset", { mode: "reset" });
  };

  const input = "rounded-md border border-line bg-surface px-3 py-2 text-sm";

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <h3 className="font-semibold">Un usuario, un recorrido</h3>
        <p className="mt-1 text-sm text-muted">Elegí un usuario y qué hace. Los eventos pasan por <span className="font-mono">trackEvent</span> y los depósitos por <span className="font-mono">ingestWebhook</span> con firma real.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted">Usuario</span>
            <input list="sample-users" value={userId} onChange={(e) => setUserId(e.target.value)} className={`${input} font-mono`} placeholder="usr_000871" />
            <datalist id="sample-users">
              {samples.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.country} · {s.variant ?? "no elegible"}
                </option>
              ))}
            </datalist>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted">Recorrido</span>
            <select value={journey} onChange={(e) => setJourney(e.target.value as Journey)} className={input}>
              {JOURNEYS.map((j) => (
                <option key={j} value={j}>
                  {JOURNEY_LABEL[j]}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-end">
            <Button variant="primary" disabled={busy !== null || userId === ""} onClick={() => call("one", { mode: "one", userId, journey })}>
              {busy === "one" ? "Simulando…" : "Simular"}
            </Button>
          </div>
        </div>
      </Card>

      <Card>
        <h3 className="font-semibold">Muchos usuarios, una mezcla realista</h3>
        <p className="mt-1 text-sm text-muted">
          Toma usuarios asignados sin depósitos ni simulaciones previas y reparte recorridos (25 % solo miran, 15 % eligen, 15 % copian, 25 % depositan,
          5 % tarde, 5 % fallan, 5 % abren «otras opciones», 5 % vuelven). La misma semilla produce el mismo lote.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted">Usuarios</span>
            <input type="number" min={1} max={600} value={users} onChange={(e) => setUsers(Number(e.target.value))} className={input} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted">Semilla</span>
            <input type="number" min={0} value={seed} onChange={(e) => setSeed(Number(e.target.value))} className={`${input} font-mono`} />
          </label>
          <div className="flex items-end">
            <Button variant="primary" disabled={busy !== null} onClick={() => call("batch", { mode: "batch", users, seed })}>
              {busy === "batch" ? "Simulando…" : "Simular lote"}
            </Button>
          </div>
        </div>
      </Card>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm">
            <div className="font-semibold">Datos simulados en la base</div>
            <div className="mt-1 text-muted">
              {counts.sessions} sesiones · {counts.clientEvents} eventos de pantalla · {counts.deposits} depósitos · {counts.webhooks} webhooks
            </div>
          </div>
          <Button disabled={busy !== null || counts.sessions + counts.deposits === 0} onClick={reset}>
            {busy === "reset" ? "Borrando…" : "Borrar datos simulados"}
          </Button>
        </div>
        <p className="mt-3 text-xs text-muted">
          Mientras haya depósitos simulados, <span className="font-mono">/results</span> lo avisa y <span className="font-mono">npm run verify</span> reporta MISMATCH: la recomputación independiente solo conoce agosto.
        </p>
      </Card>

      {reply ? (
        <Card>
          {reply.error ? (
            <p className="text-sm text-danger">{reply.error}</p>
          ) : reply.removed ? (
            <p className="text-sm">
              Borrados: {reply.removed.clientEvents} eventos de pantalla, {reply.removed.deposits} depósitos, {reply.removed.webhooks} webhooks.
            </p>
          ) : (
            <ReportList reports={reply.reports ?? []} />
          )}
        </Card>
      ) : null}
    </div>
  );
}

function ReportList({ reports }: { reports: JourneyReport[] }) {
  const byJourney = Object.groupBy(reports, (r) => r.journey);
  return (
    <div className="flex flex-col gap-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{reports.length} recorrido{reports.length === 1 ? "" : "s"} simulado{reports.length === 1 ? "" : "s"}</span>
        {Object.entries(byJourney).map(([j, rs]) => (
          <Pill key={j}>
            {JOURNEY_LABEL[j as Journey]}: {rs?.length ?? 0}
          </Pill>
        ))}
        <span className="ml-auto flex gap-3">
          <a href="/funnel" className="underline">
            ver embudo
          </a>
          <a href="/results" className="underline">
            ver resultados
          </a>
        </span>
      </div>
      <ul className="divide-y divide-line font-mono text-xs">
        {reports.slice(0, 40).map((r, i) => (
          <li key={`${r.userId}-${i}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
            <a href={`/u/${r.userId}/fund`} className="underline">
              {r.userId}
            </a>
            <Pill tone={r.variantShown === "B" ? "accent" : "neutral"}>{r.variantShown}</Pill>
            <span>{r.journey}</span>
            <span className="text-muted">{r.methodId}</span>
            <span className="text-muted">
              {r.events.map((e) => e.name.replace("funding_", "")).join(" → ")}
              {r.webhooks.length ? ` → ${r.webhooks.map((w) => w.type.replace("deposit.", "")).join(" → ")}` : ""}
            </span>
            {[...r.events, ...r.webhooks].some((x) => !["stored", "processed", "duplicate", "noop"].includes(x.outcome)) ? (
              <Pill tone="danger">rechazado</Pill>
            ) : null}
          </li>
        ))}
        {reports.length > 40 ? <li className="py-2 text-muted">… y {reports.length - 40} más</li> : null}
      </ul>
    </div>
  );
}
