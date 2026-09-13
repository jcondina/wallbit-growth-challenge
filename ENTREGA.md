# Entrega

---

## Cómo correrlo

Desde un clon limpio, con Node 24 y Python 3:

```
npm run setup            # npm ci + base limpia + data/*.json
npm run dev              # http://localhost:3000
npm run replay           # en otra terminal: reproduce agosto → [sim] terminado. 2xx: 648  errores: 0
npm run verify           # recomputación independiente en Python → MATCH
npm run test:tz          # 142 tests bajo cuatro zonas horarias
```

Después: `/results` (el resultado), `/funnel` (dónde se traba la gente), `/`
(usuarios de muestra para abrir la pantalla), `/admin` (kill switch). El
detalle de cada comando está en el [README](README.md).

---

## Qué construí y qué dejé afuera

**Construí**, en el orden en que lo habría hecho con 4 horas:

1. **La pantalla en dos variantes** (`/u/<usuario>/fund`). A: todos los métodos
   elegibles como tarjetas iguales. B: una tarjeta destacada con el método
   recomendado para el país y el resto detrás de «ver otras opciones». Es el
   mismo componente con una prop distinta; una línea de texto arriba dice qué
   está viendo cada usuario. `?preview=A|B` muestra una variante sin asignar ni
   registrar nada.
2. **Asignación determinística y persistida** (hash → tabla), inscripción al
   registro, y elegibilidad estricta: los 600 usuarios anteriores al 1 de
   agosto ven A y no entran nunca en el denominador.
3. **Recepción de webhooks idempotente**: verificación HMAC sobre los bytes
   crudos, bandeja de entrada por `event_id`, un reducer puro que llega al
   mismo estado con cualquier orden de entrega, duplicados y reenvíos con id
   nuevo, todo en una transacción. Correr el simulador dos veces deja la base
   byte a byte igual.
4. **La lectura del resultado** (`/results` y `/api/results`) con la
   definición exacta de la métrica y un veredicto generado por código, más
   `scripts/verify.py`: recalcula todo desde los JSON en Python, sin compartir
   código con la app, y compara 20 campos contra el endpoint.
5. **Tracking y embudo**: catálogo de eventos con esquemas estrictos,
   `/api/track`, y `/funnel` con usuarios únicos por paso, por variante y por
   método.
6. De la lista «casi seguro no entran»: **significancia** (z-test, intervalos,
   MDE y tamaño de muestra), **corte por país**, **kill switch** sin deploy.
   Además una **línea base** con la cohorte previa medida con la misma
   definición, y **verificación de firma**.

**Dejé afuera, y por qué:**

- **Autenticación**: el enunciado lo excluye; la URL dice quién es el usuario
  y `/admin` está abierto.
- **Denominador por exposición como titular**: el simulador no produce vistas
  de pantalla, así que el denominador es *asignados* (intención de tratar). La
  exposición se registra igual y `/results` muestra el corte cuando existe.
- **Segundo experimento en paralelo**: no hay UI, pero el diseño ya lo
  soporta — el hash lleva el id del experimento y la clave de asignación es
  (experimento, usuario). Es una fila más en `experiments`.
- **Kill switch «de verdad»**: es un flag en la base con un endpoint, no un
  servicio de feature flags con auditoría.
- **Motivo de las fallas**: el payload del proveedor no trae `reason`; sin
  ese campo no se puede cortar la tasa de fallo por causa. Es lo primero que le
  pediría al proveedor.
- **Deploy, CI, Docker, migraciones formales, rate limiting**: fuera del
  ejercicio.

**Si tuviera 4 horas más:** pedir `reason` al proveedor y cortarlo por método;
un test de punta a punta del click-through en el navegador; un segundo
experimento de prueba para demostrar la independencia del hash; alertas cuando
aparezcan anomalías en la ingesta; el denominador por exposición como vista
alternativa en `/results`.

---

## Asignación de variantes

`bucket = sha256("funding_recommended_v1:" + user_id)[0..8] mod 100`; A si
`bucket < 50`, B si no. Al asignar se guarda en `assignments` (experimento,
usuario, variante, versión de la asignación, fecha) y de ahí en adelante manda
la tabla; el hash solo se consulta la primera vez.

Por qué así:

- **Determinista**: dos requests simultáneos del mismo usuario calculan la
  misma variante; no hay carrera posible. `verify.py` replica la fórmula en
  otro lenguaje y llega a los mismos 296 / 304.
- **Persistida**: si mañana cambia la proporción (50/50 → 90/10), los usuarios
  ya asignados no se barajan; la columna `allocation_version` permite cortar
  por ese cambio.
- **Con sal**: el id del experimento está en el hash, así que un segundo
  experimento sobre los mismos usuarios obtiene una partición independiente.
- **Al registro, no a la exposición**: el seed inscribe a los 600 elegibles con
  `assigned_at = created_at`. Es la decisión de intención de tratar que
  explico abajo.
- **Elegibilidad**: `created_at >= 2026-08-01T00:00:00Z`. Los 600 usuarios
  anteriores ven A y no se inscriben. Con corte a medianoche de Argentina
  serían 595 elegibles; el dataset está en UTC y así lo tomé.
- **Pausa**: con el experimento pausado todos ven A, no se inscribe a nadie
  nuevo y las asignaciones existentes quedan intactas.

---

## Modelo de eventos

Una tabla `events`, append-only, con un esquema estricto por nombre (un campo
de más rechaza el evento). Sobre común: `event_id`, `user_id`, `occurred_at`,
`recorded_at`, `source`, `experiment_id`, `variant_shown`, `country`,
`session_id`. Cada evento existe porque una pregunta de Growth lo necesita:

| Pregunta | Evento | Datos |
|---|---|---|
| ¿Cuántos vieron la pantalla, y cuál? | `funding_screen_viewed` | métodos mostrados en orden, recomendado, cuántos visibles, zona horaria del cliente |
| ¿Se congelan eligiendo? ¿Son indecisos? | `funding_method_selected` | método, posición, si era el recomendado, por dónde llegó (`list` / `primary` / `expanded`), ms desde la vista, cuántas selecciones previas |
| ¿B rechaza la recomendación? | `funding_options_expanded` | ms desde la vista |
| ¿Las instrucciones asustan? | `funding_details_copied` | método, **nombre** del campo (nunca el valor), ms desde la selección |
| ¿Miran y se van? | `funding_screen_left` | ms en pantalla, último paso (`viewed` / `selected` / `copied`); mejor esfuerzo vía `sendBeacon` |
| ¿Cuánto tarda el banco? ¿Qué falla? | `deposit_received` / `deposit_completed` / `deposit_failed` | derivados del webhook, uno por transición, con la hora del hecho del proveedor |
| Denominador | `experiment_assigned` | variante, versión de la asignación |

Reglas que lo hacen confiable: el reloj del cliente **no** es un timestamp
(los eventos de pantalla llevan la hora del servidor; las duraciones se miden
en el cliente); `INSERT OR IGNORE` por `event_id` (StrictMode, reintentos y
volver atrás no duplican); `variant_shown` es lo que la pantalla renderizó,
no lo que dice la tabla, y si difieren se registra y se cuenta; sin PII.

Lo que el esquema **no** puede responder: *por qué* falla un depósito. El
webhook no trae motivo.

Los eventos sirven para el embudo. La métrica de activación se lee de la
tabla `deposits`, nunca del log de eventos: una pregunta, una fuente.

---

## Línea base y objetivo

Medí la cohorte previa (600 usuarios, mayo–julio) con **la misma función** que
el experimento. Tres números, según la definición:

| Definición | Previo | Agosto |
|---|---|---|
| Depositó alguna vez | **33,5 %** (201/600) ← «un tercio» | 42,3 % |
| Inició un depósito ≤ 168 h | 27,2 % | 35,0 % |
| **Acreditado ≤ 168 h** (la métrica) | **23,0 %** (138/600) | 35,0 % (210/600) |

La brecha entre 33,5 % y 23,0 % se descompone en −6,3 pp de gente que
deposita después del día 7 (lo que la pantalla puede mover: la mediana hasta
iniciar es 2,9 días) y −4,2 pp de gente que actuó a tiempo pero eligió un
método que acreditó fuera de la ventana (mediana de acreditación: 29 h). Solo
el 11 % de los activadores usó el método local de su país.

**La línea base no es el grupo de comparación.** El control A (38,2 %)
también supera a la línea base (z = 4,8): agosto convierte más que el
histórico en ambas variantes. Si hubiéramos lanzado B a todos el 1 de agosto y
comparado contra julio, habríamos reportado «+12 pp» y estaríamos
completamente equivocados. Eso, en el propio dataset, es el argumento a favor
del experimento aleatorizado.

**No fijé un objetivo de mejora.** `/results` muestra qué puede detectar el
experimento (efectos ≥ 11 pp con ~300 por variante) y cuántos usuarios haría
falta para cada lift (+5 pp: ~3.000 usuarios, ~1,8 meses al ritmo observado de
registros). Growth pone la vara.

---

## Embudo y dolores del flujo

`/funnel` cuenta usuarios únicos en vio → eligió → copió → detectado →
acreditado, solo entre asignados que abrieron la pantalla instrumentada;
además por método (eligió → copió → detectado → acreditado → fallido) y
señales de fricción: indecisión (métodos probados), vueltas sin depositar,
abandono por paso, depositó por otro método que el elegido.

**Agosto no tiene eventos de pantalla por construcción**: el simulador solo
emite webhooks. La página lo dice y se llena en vivo al abrir la pantalla de
cualquier usuario (se refresca sola cada 5 s). No generé datos sintéticos de
embudo: nada inventado en una entrega de Growth.

---

## El resultado

**¿Cuántos usuarios convirtieron en cada variante?**

| Variante | Usuarios en el experimento | Convertidos | Tasa |
|---|---|---|---|
| A (control) | 296 | 113 | 38,2 % (IC 95 %: 32,8–43,8) |
| B (recomendado) | 304 | 97 | 31,9 % (IC 95 %: 26,9–37,3) |

B − A = −6,3 pp (IC 95 %: −13,9 a +1,4 pp), p = 0,11. Veredicto generado:
**no hay diferencia detectable**.

**¿Cómo definiste «convertido»?** Usuario asignado cuyo primer depósito
**acreditado** (`deposit.completed`) tiene `occurred_at` ≤ `created_at` +
168 h, inclusive, medido con la hora del hecho del proveedor. Dejé afuera:
depósitos detectados pero no acreditados (`received`), fallidos (45; 31
usuarios solo con fallos), acreditados después de la ventana (44 usuarios), y
todo usuario registrado antes del 1 de agosto. Cuento a todos los asignados,
hayan visto o no la pantalla. Un depósito con `completed` y `failed` a la vez
sería «conflicto» y no contaría; no hay ninguno.

**¿Lanzarías la variante B a todos los usuarios? ¿Por qué?** No. Y tampoco la
mataría:

- La diferencia está dentro del ruido: el intervalo cruza cero, p = 0,11, y
  con este tamaño el experimento solo ve efectos ≥ 11 pp.
- El simulador es ciego a la variante — emite los mismos depósitos vea lo que
  vea el usuario — así que cualquier diferencia es la partición del hash, no
  la pantalla. Se nota en el mecanismo: la proporción de primeros depósitos por
  el método recomendado es 15,6 % en A, 11,9 % en B y 11,9 % en la línea base.
  Si B funcionara, esa fila tendría que moverse primero.
- Lo honesto es seguir corriendo: un efecto de +5 pp, que sí valdría la pena,
  necesita ~3.000 usuarios. La infraestructura queda lista para eso.

---

## Supuestos y decisiones de criterio

- **Corte del experimento a las 00:00 UTC** del 1 de agosto (5 usuarios entre
  las 00:00 y las 03:00 UTC entran; a medianoche de Buenos Aires quedarían
  afuera).
- **Ventana = 168 horas**, inclusive, desde el registro. No «7 días
  calendario»: no hay aritmética de calendario en el código.
- **KYC no filtra**: el enunciado lo saca del alcance y el proveedor acreditó
  depósitos a 4 usuarios `rejected`. Todos cuentan (con solo `approved`: 187
  de 540).
- **Recomendación de B**: transferencia local del país → transferencia
  regional que liste al país (SEPA para ES) → wire (UY no tiene rail local).
  «Local siempre» es la hipótesis del enunciado; en PE/BO/GT/DO el rail local
  acredita en 36–48 h, tan lento como un wire, y el corte por país muestra si
  eso pesa.
- **Reenvíos con `occurred_at` distinto**: se queda la hora más temprana.
  **Campos del payload**: manda el evento de mayor precedencia (`completed` >
  `failed` > `received`), nunca el orden de llegada. El test de permutaciones
  encontró que «gana el último final» dependía del orden; lo cambié.
- **Usuario o método desconocido, monto no positivo, depósito anterior al
  registro, fecha futura**: se guardan y se marcan como anomalía, nunca se
  rechazan (un 4xx haría al proveedor reintentar para siempre). Hay cero en el
  dataset.
- **Ambas variantes requieren un toque para ver los datos** («Ver datos» /
  «Ver datos para transferir»): así el paso elegir → copiar es comparable y B
  quita la *elección*, no la revelación.
- **Tiempo**: el negocio solo maneja instantes (epoch ms, tipo con marca);
  `parseInstant` rechaza timestamps sin zona; las columnas son `INTEGER` con
  `CHECK(typeof)`; ningún archivo de dominio toca `Date` salvo `time.ts` (un
  test lo vigila); la suite corre igual bajo cuatro zonas horarias.
- **Depósitos históricos** entran a la misma tabla con `source = historical`
  e `initiated_at = created_at`; ninguno pertenece a un usuario elegible.
- **Potencia** calculada sobre la tasa del control y el ritmo de registros
  observado en la cohorte (600 en 11 días).

---

## Lo que sé que está flojo

- `/admin` y `/api/track` no tienen autenticación; `user_id` en un evento es
  falsificable.
- Denominador por asignación, no por exposición: con tráfico real habría que
  reportar ambos.
- `initiated_at` es la hora en que el proveedor *detectó* fondos, no la hora
  en que el usuario apretó «enviar» en su banco.
- Sin motivo de falla (falta en el payload).
- `P(B > A)` usa la aproximación normal de las posteriores Beta; vale con
  n ≳ 50 por brazo y así está rotulado.
- SQLite en un proceso: en Postgres el `INSERT OR IGNORE` de la bandeja sería
  `INSERT … ON CONFLICT DO NOTHING RETURNING`, nunca leer-y-escribir.
- `funding_screen_left` es un piso, no un total: el móvil a veces mata el
  beacon.
- Los eventos de depósito llevan la hora de la primera transición; si un
  reenvío trae una hora más temprana, la tabla `deposits` la toma y el log de
  eventos no.
- Sin rate limiting, sin migraciones formales (una sola migración aditiva
  guardada en código), sin deploy.

---

## Uso de IA

Usé Claude Code (Opus) de principio a fin, en dos modos. Primero como
interlocutor: antes de escribir código iteramos el plan por áreas — qué
está probando el dataset, el modelo de tiempo, los casos límite de la
ingesta, la línea base y el árbol de métricas, qué tiene que mostrar el
tablero para no engañar a nadie, el tracking, la UI — y cada decisión de
producto la tomé yo con opciones sobre la mesa (idioma, KYC, extras, MDE sin
objetivo fijo, regla de B, driver de base, estilo, si inventar datos de
embudo). Ese plan está en `PLAN.md`. Después, para implementar fase por fase:
la IA escribió la mayoría del código y de los tests a partir del plan, yo lo
revisé, corrí y ajusté. Dos hallazgos salieron de esa dinámica y no de mí: el
test de permutaciones que encontró la dependencia de orden en el reducer, y
que Next 16 quitó `export const dynamic` (las páginas usan `connection()`).
Entiendo cada línea y puedo extenderla.

---

## Tiempo

Unas 11 horas de reloj, en tres tandas:

- **Planificación, ~2 h.** Leer el enunciado y los datos, discutir el modelo
  de tiempo, los casos límite de la ingesta, la línea base y cómo evitar que el
  tablero se lea mal. De ahí salió `PLAN.md`.
- **Implementación, ~7 h.** Las siete fases, una por commit, con su gate cada
  una (tests en cuatro zonas horarias, lint, typecheck, build) y el ensayo en
  un clon limpio al final. Después una pasada de simplificación, otra de
  robustez y determinismo, y la documentación.
- **Después, ~2 h.** El simulador de recorridos, la navegación, la landing y
  esta última revisión de casos límite.

Más que las 4 del enunciado: preferí terminar cada pieza antes que entregar
ocho a medio hacer, y el tiempo extra fue sobre todo en los casos límite de la
ingesta y en que el tablero no se pueda leer mal.
