/**
 * Spanish copy shared by pages and the JSON endpoint. The metric definition
 * travels with the numbers on purpose: a spreadsheet that consumes
 * /api/results gets the caveat, not just the rate.
 */

export const ACTIVATION_DEFINITION =
  "Activado = primer depósito acreditado (deposit.completed) dentro de las 168 h posteriores al registro, " +
  "según la hora del hecho informada por el proveedor (occurred_at). No cuentan depósitos detectados pero no " +
  "acreditados, ni fallidos, ni acreditados después de la ventana. Se cuenta a todos los usuarios asignados, " +
  "hayan visto o no la pantalla (intención de tratar).";

export const BASELINE_CAVEAT =
  "La línea base es contexto, no comparación: el control A también supera al histórico, así que comparar B " +
  "contra la línea base sobreestimaría su efecto. La comparación válida es B contra A, en el mismo período.";

export const COUNTRY_CUT_CAVEAT =
  "Con diez países, es esperable que alrededor de uno muestre p < 0,05 por azar. Estas filas sirven para " +
  "generar hipótesis, no para tomar decisiones.";

export const CLIENT_DATA_UNAVAILABLE = "sin datos en la simulación";

export const COUNTRY_NAMES: Record<string, string> = {
  AR: "Argentina",
  MX: "México",
  CO: "Colombia",
  BR: "Brasil",
  PE: "Perú",
  UY: "Uruguay",
  BO: "Bolivia",
  DO: "República Dominicana",
  GT: "Guatemala",
  ES: "España",
  US: "Estados Unidos",
};

export const countryName = (code: string): string => COUNTRY_NAMES[code] ?? code;

/** "AR" → 🇦🇷 via regional indicator symbols. */
export const flagEmoji = (code: string): string =>
  code
    .toUpperCase()
    .split("")
    .map((c) => String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65))
    .join("");
