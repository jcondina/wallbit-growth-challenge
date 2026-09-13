/**
 * Glossary for /results, in the order a Growth reader meets the terms on
 * the page: the verdict first, then the statistics under it, then the
 * deposit vocabulary and the plumbing. Kept as data so the same list can be
 * reused on other pages or exported.
 */

export interface GlossaryEntry {
  term: string;
  definition: string;
}

export interface GlossaryGroup {
  title: string;
  entries: GlossaryEntry[];
}

export const GLOSSARY: GlossaryGroup[] = [
  {
    title: "El experimento",
    entries: [
      { term: "A · control", definition: "La pantalla de hoy: todos los métodos elegibles para el país, en tarjetas iguales. Es contra lo que se compara." },
      { term: "B · tratamiento", definition: "La pantalla nueva: un método recomendado según el país, destacado; el resto detrás de «ver otras opciones»." },
      { term: "Asignado", definition: "Usuario que al registrarse cayó en A o en B, por un hash de su id. La asignación es fija: siempre ve la misma variante." },
      {
        term: "Intención de tratar",
        definition:
          "Se cuenta a todos los asignados, hayan abierto la pantalla o no. Evita que la comparación se sesgue por quiénes llegaron a verla. Es el denominador de esta página.",
      },
      { term: "Vio la pantalla · exposición", definition: "El usuario abrió de verdad la pantalla de ingreso (evento de cliente). En el mes simulado no hay pantallas, por eso esa fila dice «sin datos»." },
      { term: "Línea base", definition: "Los usuarios registrados antes del experimento, medidos con la misma regla. Sirve de contexto: la comparación válida es B contra A, en el mismo período." },
      { term: "Pausado · kill switch", definition: "Con el experimento pausado todos ven A, también los asignados a B. Las asignaciones no se pierden; al reanudar cada uno vuelve a su variante." },
    ],
  },
  {
    title: "La métrica",
    entries: [
      { term: "Activado", definition: "Primer depósito acreditado dentro de las 168 h (7 días) posteriores al registro. Es la métrica principal; su definición completa está bajo el veredicto." },
      { term: "Ventana", definition: "Las 168 h que arrancan al registrarse. Un depósito acreditado después no activa, aunque el usuario haya empezado a tiempo." },
      { term: "Ventana cerrada · pendiente", definition: "Cerrada: ya pasaron las 168 h y el resultado es definitivo. Pendiente: el usuario todavía puede activar, así que su «no» es provisional." },
      { term: "Acreditaron después de la ventana", definition: "Conversión tardía: el dinero llegó, pero fuera de los 7 días. No cuenta como activación, y por eso se muestra aparte." },
      { term: "Depositaron alguna vez", definition: "Al menos un depósito acreditado, dentro o fuera de la ventana. Es el «un tercio» del enunciado." },
      { term: "Guardrail", definition: "Métrica que B no debería empeorar aunque mejore la activación: tasa de fallo y monto del primer depósito." },
      { term: "Tasa de fallo", definition: "Depósitos fallidos sobre depósitos finalizados (acreditados + fallidos). Los que siguen en curso no entran." },
      { term: "Mediana", definition: "El valor del medio: la mitad de los casos está por debajo y la mitad por encima. A diferencia del promedio, un depósito enorme no la mueve." },
    ],
  },
  {
    title: "La estadística",
    entries: [
      { term: "pp · puntos porcentuales", definition: "La diferencia entre dos porcentajes: 31,9 % − 38,2 % = −6,3 pp. No es «−6,3 %», que sería una variación relativa." },
      {
        term: "IC 95 % · intervalo de confianza",
        definition:
          "El rango de valores reales compatibles con los datos. Si el intervalo de la diferencia cruza el cero, los datos no alcanzan para decir cuál variante es mejor. Es la barra al lado de cada tasa.",
      },
      { term: "p · valor p", definition: "Probabilidad de ver una diferencia como esta, o mayor, si en realidad no hubiera ninguna. Por debajo de 0,05 (α) se considera «detectada»." },
      { term: "z", definition: "La diferencia entre las dos tasas medida en errores estándar. Cuanto más lejos de cero, más difícil de explicar por azar; el valor p sale de ahí." },
      {
        term: "Potencia",
        definition:
          "Probabilidad de detectar un efecto que existe de verdad. Se usa 80 %: si B fuera mejor por el efecto mínimo detectable, 8 de cada 10 experimentos como este lo verían.",
      },
      {
        term: "Efecto mínimo detectable",
        definition:
          "El cambio más chico que este experimento, con estos usuarios, podía detectar. Un resultado «no detectable» quiere decir «no hay un efecto de ese tamaño», no «no hay efecto».",
      },
      { term: "Usuarios necesarios", definition: "Cuántos usuarios por variante haría falta para detectar cada tamaño de efecto. «Al ritmo observado» lo traduce a meses de registros." },
      { term: "P(B > A)", definition: "Probabilidad de que B sea realmente mejor que A, dada la evidencia. Es la lectura bayesiana de la misma información que el intervalo, no un dato nuevo." },
      { term: "Muestras chicas", definition: "Con pocos usuarios el intervalo es ancho y cualquier fila puede salir «significativa» por azar. Por eso el corte por país sirve para hipótesis, no para decidir." },
    ],
  },
  {
    title: "Los depósitos y los datos",
    entries: [
      { term: "Detectado · en curso", definition: "El proveedor vio que entró dinero (deposit.received), pero todavía no está acreditado: puede completarse o fallar." },
      { term: "Acreditado", definition: "El dinero quedó disponible en la cuenta (deposit.completed). Es el único estado que activa." },
      { term: "Fallido", definition: "El depósito no se completó (deposit.failed). Si el usuario reintenta, es un depósito nuevo con otro id." },
      { term: "Conflicto", definition: "Un mismo depósito informado como acreditado y como fallido. No se descarta ninguno, pero no cuenta como activación hasta que se aclare." },
      { term: "Webhook", definition: "El aviso que manda el proveedor cuando pasa algo con un depósito. Puede llegar repetido, desordenado o tarde; la app está hecha para eso." },
      { term: "Duplicado · reenvío", definition: "Duplicado: el mismo aviso llegó dos veces y se ignoró. Reenvío: el mismo hecho llegó con otro id; tampoco cambia nada. Ninguno infla los números." },
      { term: "Hora del hecho", definition: "El momento en que pasó algo según el proveedor (occurred_at), no cuando nos enteramos. Con esa hora se decide si un depósito entra en la ventana." },
      { term: "UTC", definition: "El reloj de referencia único. Todas las horas de esta página están en UTC, para que dos personas en países distintos lean el mismo valor." },
      { term: "Datos simulados", definition: "Recorridos generados desde /simulate para probar los tableros. Están marcados, la cabecera avisa mientras existan y se borran desde esa misma página." },
    ],
  },
];
