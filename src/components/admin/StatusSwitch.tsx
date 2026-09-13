"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";

interface Props {
  experimentId: string;
  status: "running" | "paused" | "finished";
}

/** One button. Pausing asks for confirmation because every user sees control from the next request on. */
export function StatusSwitch({ experimentId, status }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const next = status === "running" ? "paused" : "running";

  const submit = async () => {
    if (next === "paused" && !window.confirm("¿Pausar el experimento? Todos los usuarios verán la variante A hasta reanudar.")) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/experiments/${experimentId}/status`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-3">
      <Button variant={next === "paused" ? "secondary" : "primary"} onClick={submit} disabled={busy || status === "finished"}>
        {status === "running" ? "Pausar experimento" : status === "paused" ? "Reanudar experimento" : "Finalizado"}
      </Button>
      {error ? <span className="text-sm text-danger">{error}</span> : null}
    </div>
  );
}
