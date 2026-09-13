# Wallbit · experimento en la pantalla de ingreso de dinero

Un método recomendado según el país (**B**) contra la lista completa de
métodos (**A**), medido sobre la activación: primer depósito acreditado dentro
de los 7 días del registro.

Este repo tiene la pantalla en sus dos variantes, la asignación de variantes,
el tracking, la recepción de los webhooks del proveedor (idempotente, sin
importar orden ni reenvíos) y la lectura del resultado.

- Enunciado original: [`CHALLENGE.md`](CHALLENGE.md)
- Decisiones, resultado y alcance: [`ENTREGA.md`](ENTREGA.md)
- Plan de implementación (en inglés, con los números de referencia): [`PLAN.md`](PLAN.md)

---

## Requisitos

- **Node 24** (`.nvmrc`); funciona desde 22.18. No hay compilación nativa: la
  base es SQLite embebida en Node (`node:sqlite`), sin nada que instalar.
- **npm** (viene con Node).
- **Python 3.8+**, solo para el simulador del proveedor y el script de
  verificación (ambos usan únicamente la librería estándar).

## Correrlo desde cero

```bash
npm run setup
```

Instala dependencias, crea la base vacía y carga `data/*.json`. Deberías ver:

```
  users                   1200  (+1200)
  funding methods           16  (+16)
  historical deposits      201  (+201)
  experiment             funding_recommended_v1  (created)
  assignments (A=296 B=304)   600  (+600)
  not eligible             600  (signed up before the experiment)
```

```bash
npm run dev
```

Abre la app en <http://localhost:3000>. En otra terminal, reproducí el mes de
agosto del proveedor:

```bash
npm run replay
```

Termina con `[sim] terminado. 2xx: 648  errores: 0`. Podés correrlo las veces
que quieras: la segunda vez todo son duplicados y los números no cambian.

Abrí <http://localhost:3000/results>. Tiene que decir **A 113 / 296 = 38,2 %,
B 97 / 304 = 31,9 %** y «No hay diferencia detectable entre A y B».

```bash
npm run verify
```

Recalcula todo desde los JSON crudos en Python — sin compartir código con la
app — y lo compara con `/api/results`. Termina en `MATCH`.

## Qué hay en cada URL

Todas las páginas comparten la barra de navegación de arriba.

| URL | Qué es |
|---|---|
| `/` | Portada: qué es esto y qué pregunta responde, los números en vivo, qué se puede hacer, y usuarios de muestra (uno por país y uno anterior al experimento) con enlaces a su pantalla |
| `/u/<usuario>/fund` | La pantalla de ingreso de dinero, en la variante que le toca a ese usuario (no hay login: la URL dice quién es) |
| `/u/<usuario>/fund?preview=A` / `?preview=B` | La misma pantalla en una variante elegida, sin asignar ni registrar eventos |
| `/results` | El resultado del experimento para Growth |
| `/funnel` | Dónde se traba la gente: usuarios únicos por paso, por variante y por método; se actualiza sola |
| `/simulate` | Simulador de recorridos: genera usuarios que ven, eligen, copian y transfieren, por los mismos servicios que el tráfico real; se borra de un botón |
| `/admin` | Kill switch: pausar / reanudar sin deploy |
| `/api/results`, `/api/funnel` | Lo mismo que las páginas, en JSON (incluyen la definición de la métrica y el veredicto) |
| `/api/track` | Donde la pantalla envía sus eventos |
| `/api/health` | Liveness |
| `/webhooks/deposits` | El endpoint que recibe los webhooks del proveedor |

## Scripts

| Comando | Qué hace |
|---|---|
| `npm run setup` | `npm ci` + base limpia + fixtures |
| `npm run seed` | Carga `data/*.json` e inscribe a los usuarios elegibles. Idempotente: la segunda vez todo es `+0` |
| `npm run db:reset` | Borra `var/wallbit.db` |
| `npm run replay` | Espera a la app, la calienta y corre el simulador con `--stop-on-error`. Acepta los flags del simulador: `npm run replay -- --limit 50`; con `-- --delay-ms 0` reproduce todo agosto en ~6 s en vez de ~90 s |
| `npm run verify` | Recomputación independiente en Python contra `/api/results` (`-- --url http://localhost:3001` para otro puerto, `-- --offline` para solo imprimir) |
| `npm test` | Tests (vitest) |
| `npm run test:tz` | Los mismos tests bajo UTC, Buenos Aires, Tokio y Chatham (+12:45): tienen que dar idéntico |
| `npm run lint` / `npm run typecheck` / `npm run build` | Lo esperable |

## Configuración

Ningún valor es obligatorio; un clon limpio funciona sin `.env`. Ver
[`.env.example`](.env.example): ruta de la base, secreto del webhook y si se
verifica la firma.

## Dónde mirar

El enunciado dice qué mira. Dónde está cada cosa:

| Miran | Dónde |
|---|---|
| Que el resultado sea correcto | `src/domain/activation.ts` (la definición, una sola), `src/services/experimentResults.ts` (la lectura), `tests/replay.test.ts` (el escenario entero por el dominio → 210 de 600), `scripts/verify.py` (recomputación independiente) |
| Cómo se asignan variantes | `src/domain/assignment.ts`, `src/services/enrollUser.ts`, `tests/domain/assignment.test.ts` |
| Cómo se modelaron los eventos | `src/domain/events.ts` (catálogo con esquemas estrictos), `src/domain/funnel.ts`, `/funnel` |
| Cómo se maneja la acreditación asincrónica | `src/domain/deposit.ts` (reducer puro: cualquier orden, duplicados y reenvíos llegan al mismo estado), `src/services/ingestWebhook.ts` (una transacción), `tests/domain/deposit.test.ts` (todas las permutaciones) |
| Decisiones de alcance | [`ENTREGA.md`](ENTREGA.md) |

## Estructura

```
src/domain/      reglas puras: tiempo, experimento, asignación, recomendación, depósitos, activación, eventos, estadística, veredicto, embudo
src/infra/       SQLite (node:sqlite), esquema, repositorios
src/services/    casos de uso: seed, inscripción, ingesta de webhooks, tracking, resultados, embudo, kill switch
src/app/         páginas y rutas de Next.js
src/components/  primitivas de UI, pantalla de ingreso, resultados, embudo, admin
src/content/     textos en español, instrucciones de cada método (datos de sandbox)
scripts/         seed, reset, replay, verify
tests/           vitest; cada archivo abre con por qué importa testear ahí
data/, simulator/  el material del enunciado, sin modificar
```

## Problemas frecuentes

- **El puerto 3000 está ocupado.** `PORT=3001 npm run dev`, y después
  `APP_URL=http://localhost:3001 npm run replay` y `npm run verify -- --url http://localhost:3001`.
- **`python3: command not found`.** Solo hace falta para `replay` y `verify`;
  cualquier Python 3.8+ sirve.
- **Quiero correr el simulador con `--no-signature`.** Levantá la app con
  `WEBHOOK_VERIFY_SIGNATURE=false npm run dev`; si no, responde 401 (que es lo
  correcto).
- **`/` dice «Base vacía».** Falta `npm run seed`.
- **Corrí el simulador dos veces y los números no cambiaron.** Es la idea. Lo
  único que sube es «webhooks recibidos» en la calidad de datos de `/results`.
- **`npm run verify` dice MISMATCH.** Casi seguro hay datos simulados desde
  `/simulate` (la cabecera de `/results` lo avisa). Borralos desde esa misma
  página y volvé a correrlo.
- **Windows.** Los scripts `dev`/`start` fijan `TZ=UTC` con sintaxis de shell
  POSIX; en PowerShell usá `$env:TZ='UTC'; npx next dev` (o WSL). El diseño no
  depende de la zona horaria del proceso — `npm run test:tz` lo prueba — pero
  la fijamos igual.
