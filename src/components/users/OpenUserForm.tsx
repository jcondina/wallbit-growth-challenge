"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";

/** Type any user id and open their funding screen (or a preview of a variant). */
export function OpenUserForm() {
  const router = useRouter();
  const [id, setId] = useState("");
  const go = (preview?: "A" | "B") => {
    const clean = id.trim();
    if (!clean) return;
    router.push(`/u/${encodeURIComponent(clean)}/fund${preview ? `?preview=${preview}` : ""}`);
  };
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        go();
      }}
    >
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted">Id de usuario</span>
        <input
          value={id}
          onChange={(e) => setId(e.target.value)}
          placeholder="usr_000871"
          className="rounded-md border border-line bg-surface px-3 py-2 font-mono text-sm"
        />
      </label>
      <Button type="submit" variant="primary" disabled={id.trim() === ""}>
        Abrir su pantalla
      </Button>
      <Button type="button" disabled={id.trim() === ""} onClick={() => go("A")}>
        Preview A
      </Button>
      <Button type="button" disabled={id.trim() === ""} onClick={() => go("B")}>
        Preview B
      </Button>
    </form>
  );
}
