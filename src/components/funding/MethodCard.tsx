"use client";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Pill } from "@/components/ui/Pill";
import type { Instructions } from "@/content/fundingInstructions";
import { InstructionsPanel } from "./InstructionsPanel";

export interface MethodView {
  id: string;
  name: string;
  kind: "local_transfer" | "bank_transfer" | "crypto" | "third_party";
  currency: string;
  settlementHours: number;
  feePct: number;
}

const KIND_LABEL: Record<MethodView["kind"], string> = {
  local_transfer: "Transferencia local",
  bank_transfer: "Transferencia bancaria",
  crypto: "Cripto",
  third_party: "Plataforma",
};

const settlement = (h: number) => (h < 24 ? `Acredita en ~${h} h` : `Acredita en ~${Math.round(h / 24)} día${h >= 48 ? "s" : ""}`);
const fee = (pct: number) => (pct === 0 ? "Sin comisión" : `Comisión ${pct.toLocaleString("es-AR")} %`);

interface Props {
  method: MethodView;
  /** hero = variant B's single recommendation; list = every card in variant A and B's "otras opciones" */
  emphasis: "hero" | "list";
  recommendedFor?: string;
  selected: boolean;
  instructions: Instructions;
  onSelect: () => void;
  onCopy: (field: string) => void;
}

export function MethodCard({ method, emphasis, recommendedFor, selected, instructions, onSelect, onCopy }: Props) {
  const hero = emphasis === "hero";
  return (
    <Card emphasis={hero ? "accent" : "default"}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          {hero && recommendedFor ? (
            <div className="mb-2">
              <Pill tone="accent">Recomendado para {recommendedFor}</Pill>
            </div>
          ) : null}
          <h3 className={`font-semibold ${hero ? "text-xl" : "text-base"}`}>{method.name}</h3>
          <p className="mt-1 text-sm text-muted">
            {KIND_LABEL[method.kind]} · {method.currency}
          </p>
          <p className={`mt-2 ${hero ? "text-base" : "text-sm"}`}>
            {settlement(method.settlementHours)} · {fee(method.feePct)}
          </p>
        </div>
        {!selected ? (
          <Button variant={hero ? "primary" : "secondary"} className="shrink-0" onClick={onSelect} aria-expanded={selected}>
            {hero ? "Ver datos para transferir" : "Ver datos"}
          </Button>
        ) : null}
      </div>
      {selected ? <InstructionsPanel instructions={instructions} onCopy={onCopy} /> : null}
    </Card>
  );
}
