/** The simulated journeys /simulate can generate, with their Spanish labels. Shared by the service and the page. */
export const JOURNEYS = ["viewed", "selected", "copied", "deposited", "late", "failed", "expanded", "looper"] as const;
export type Journey = (typeof JOURNEYS)[number];

export const JOURNEY_LABEL: Record<Journey, string> = {
  viewed: "Vio la pantalla y se fue",
  selected: "Eligió un método y se fue sin copiar",
  copied: "Copió los datos y se fue (sin depositar)",
  deposited: "Copió, transfirió y se acreditó dentro de la ventana",
  late: "Copió, transfirió y se acreditó después de los 7 días",
  failed: "Copió, transfirió y el depósito falló",
  expanded: "Abrió «otras opciones», eligió otro método y depositó con ese",
  looper: "Volvió dos veces sin elegir nada",
};

/** Why a simulated journey differs from what was asked (see `JourneyNote` in the service). */
export const NOTE_LABEL = {
  ineligible: "Anterior al experimento: no está en ninguna variante y un depósito suyo movería la línea base. No se simuló nada.",
  expanded_on_control: "La variante A no tiene «otras opciones»: se simuló un depósito desde la lista.",
} as const;
