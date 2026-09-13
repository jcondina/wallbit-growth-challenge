"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import type { Instructions } from "@/content/fundingInstructions";

interface Props {
  instructions: Instructions;
  onCopy: (field: string) => void;
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** The account data the user takes to their bank. Each field copies on its own; "Copiar todo" copies the block. */
export function InstructionsPanel({ instructions, onCopy }: Props) {
  const [copied, setCopied] = useState<string | null>(null);

  const flash = (name: string) => {
    setCopied(name);
    window.setTimeout(() => setCopied((c) => (c === name ? null : c)), 1500);
  };

  const copyField = async (name: string, value: string) => {
    await copyText(value);
    onCopy(name);
    flash(name);
  };

  const copyAll = async () => {
    await copyText(instructions.fields.map((f) => `${f.label}: ${f.value}`).join("\n"));
    onCopy("all");
    flash("all");
  };

  return (
    <div className="mt-4 border-t border-line pt-4">
      <p className="text-sm text-muted">{instructions.howTo}</p>
      <dl className="mt-3 flex flex-col gap-2">
        {instructions.fields.map((f) => (
          <div key={f.name} className="flex items-center justify-between gap-3 rounded-md bg-surface-muted px-3 py-2">
            <div className="min-w-0">
              <dt className="text-xs text-muted">{f.label}</dt>
              <dd className="truncate font-mono text-sm">{f.value}</dd>
            </div>
            <Button size="sm" onClick={() => copyField(f.name, f.value)} aria-label={`Copiar ${f.label}`}>
              {copied === f.name ? "Copiado ✓" : "Copiar"}
            </Button>
          </div>
        ))}
      </dl>
      <Button variant="primary" className="mt-3 w-full" onClick={copyAll}>
        {copied === "all" ? "Copiado ✓" : "Copiar todos los datos"}
      </Button>
    </div>
  );
}
