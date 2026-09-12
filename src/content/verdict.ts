import type { Verdict } from "@/domain/verdict";
import { formatInt, formatP, formatPp, formatPpRange } from "@/lib/format";

/**
 * Spanish rendering of a computed verdict. One template per state; the
 * thresholds (α, minimum per arm) are printed with the sentence so the
 * reader can see what "detectable" meant.
 */
export function verdictText(v: Verdict): string {
  const A = v.controlLabel;
  const B = v.treatmentLabel;
  const stats = `${B} − ${A} = ${formatPp(v.difference)} (IC 95 %: ${formatPpRange(v.differenceCI95)}) · ${formatP(v.test?.p ?? null)}`;
  const suffix = v.provisional
    ? ` (provisional: ${formatInt(v.pendingWindows)} ventana${v.pendingWindows === 1 ? "" : "s"} todavía abierta${v.pendingWindows === 1 ? "" : "s"})`
    : "";

  switch (v.state) {
    case "insufficient_data":
      return `Datos insuficientes: hacen falta al menos ${v.minPerArm} usuarios por variante para comparar.${suffix}`;
    case "b_better":
      return `${B} convierte mejor que ${A}. ${stats}.${suffix}`;
    case "a_better":
      return `${A} convierte mejor que ${B}. ${stats}.${suffix}`;
    case "no_detectable_difference":
      return (
        `No hay diferencia detectable entre ${A} y ${B}. ${stats}. ` +
        `Con este tamaño de muestra el experimento solo detecta efectos de al menos ${formatPp(v.mde).replace("+", "")} (potencia 80 %).${suffix}`
      );
  }
}

export function verdictTone(v: Verdict): "neutral" | "success" | "warning" {
  if (v.state === "b_better") return "success";
  if (v.state === "a_better") return "warning";
  return "neutral";
}
