# Challenge — Growth Engineer @ Wallbit

Hola 👋

Gracias por llegar hasta acá. Este es el último paso técnico del proceso.

Queremos ver cómo trabajás sobre un problema real de nuestro producto. 
Todo lo que sigue está pensado para respetarte el tiempo: **apuntá a 4 horas**. 
Vas a ver que el alcance es más grande que eso.
Es a propósito, y más abajo te explicamos por qué.

---

## El contexto

Wallbit le da a personas de LatAm una cuenta global: reciben pagos del
exterior, mantienen dólares e invierten en el mercado de EE.UU.

Nuestra métrica de activación es simple y es la que le importa al negocio:

> **Un usuario está activado cuando completa su primer depósito acreditado
> dentro de los 7 días de haberse registrado.**

Hoy activa alrededor de un tercio de la gente que se registra. El resto crea la
cuenta y nunca ingresa dinero.

### Dónde creemos que se pierde la gente

Cuando un usuario nuevo entra a ingresar plata por primera vez, se encuentra
con todos los métodos disponibles a la vez: transferencia local en su país,
ACH, wire, SEPA, USDT y USDC en varias redes, PayPal, Wise, Payoneer.

Es una pantalla que le pide autodiagnosticarse justo en el momento en que menos
contexto tiene sobre el producto.

### La hipótesis a probar

> Mostrarle al usuario nuevo **un único método recomendado según su país**, con
> el resto colapsado detrás de un "ver otras opciones", aumenta la tasa de
> primer depósito.

- **Control (A):** la lista completa de métodos, como hoy.
- **Variante (B):** método recomendado según el país del usuario, y el resto
  disponible pero un click más abajo.

No sabemos si es cierto. Por eso es un experimento.

---

## Lo que te pedimos

Construí lo necesario para **correr ese experimento y leer su resultado**.

1. **La pantalla de ingreso de dinero, en sus dos versiones.**
   No tiene que ser linda. Tiene que dejar claro qué ve cada usuario.

2. **Un mecanismo de asignación de variantes.**
   Un usuario tiene que poder entrar al experimento, quedar en un grupo, y que
   ese grupo se mantenga.

3. **Tracking de lo que hace el usuario.**
   El esquema de eventos lo definís vos. Contanos por qué elegiste ese.

4. **Recepción de las acreditaciones.**
   El depósito no se completa dentro de la app: el usuario copia los datos y
   transfiere desde su banco. Tu backend se entera por los webhooks del
   proveedor de pagos. Está todo en [`simulator/PROVIDER.md`](simulator/PROVIDER.md)
   — **leelo antes de escribir el endpoint.**

5. **La lectura del resultado.**
   Alguien de Growth tiene que poder abrir algo y responder *"¿cuál de las dos
   variantes está convirtiendo mejor?"*. Una página, un endpoint, un comando:
   vos decidís.

6. **Un `ENTREGA.md`** con tus decisiones. Está la plantilla en el repo.

### Y estas, casi seguro, no te van a entrar

Las dejamos escritas igual, porque **decidir qué queda afuera es parte de lo
que evaluamos**:

- Significancia estadística del resultado.
- Corte de resultados por país o por método.
- Kill switch para frenar el experimento sin deploy.
- Un segundo experimento corriendo en paralelo sobre los mismos usuarios.

---

## Sobre el alcance

Sabemos que esto no entra en 4 horas. **Ese es el ejercicio.**

En Growth nunca entra todo: el laburo es elegir qué se construye ahora, qué se
deja anotado y qué directamente no vale la pena. Un candidato que entrega tres
cosas sólidas y explica bien por qué dejó el resto afuera nos dice más que uno
que entrega ocho cosas a medio hacer.

Escribí esas decisiones. No las adivinamos.

---

## El material que te damos

```
data/users.json                  1200 usuarios con país y fecha de alta
data/funding_methods.json        catálogo de métodos y en qué países aplica
data/deposits_historicos.json    depósitos previos al experimento
simulator/PROVIDER.md            documentación del proveedor de pagos
simulator/simulate_provider.py   simulador de webhooks (Python 3.8+, sin dependencias)
simulator/scenario.json          los eventos que emite el simulador
ENTREGA.md                       plantilla para tus decisiones
```

Algunas cosas que conviene que sepas del dataset:

- **El experimento arranca el 2026-08-01.** En `users.json` hay usuarios
  anteriores a esa fecha. Están ahí a propósito; qué hacés con ellos es
  decisión tuya.
- El simulador reproduce lo que pasó entre el 2026-08-01 y el 2026-08-31.
  Cuando termina de correr, el experimento está cerrado.
- Podés correr el simulador las veces que quieras.

Para arrancar:

```bash
python3 simulator/simulate_provider.py --dry-run | head -20
python3 simulator/simulate_provider.py --url http://localhost:8000
```

---

## Reglas

**Stack libre.** Nuestro stack es Laravel y React Native, con Python y
JavaScript alrededor, pero acá no evaluamos eso. Usá lo que te haga más rápido:
vas a tener que defender tu entrega en vivo, y eso se hace mejor sobre
herramientas propias.

**Podés usar IA.** Nosotros la usamos todos los días. Lo único que te pedimos
es que entiendas cada línea que entregás, porque en la call vamos a recorrer tu
código juntos y te vamos a pedir que lo extiendas ahí mismo.

**Base de datos:** la que quieras, SQLite incluido.

**Si algo del enunciado te parece ambiguo**, resolvelo con el criterio que te
parezca mejor y anotalo en `ENTREGA.md`. Preferimos ver tu criterio antes que
responderte la pregunta. Si algo te bloquea de verdad, escribinos.

---

## Qué miramos y qué no

**Sí miramos:**

- Que el resultado del experimento que reportás sea **correcto**.
- Cómo asignás usuarios a variantes.
- Cómo modelaste los eventos.
- Cómo manejás la naturaleza asincrónica de la acreditación.
- Tus decisiones de alcance y cómo las contás.

**No miramos:**

- Que la UI sea linda. Podés usar HTML sin estilos.
- Autenticación, registro real, KYC. Asumí que ya sabés quién es el usuario.
- Cobertura de tests. Si escribís alguno, que sea donde te parezca que importa,
  y contá por qué ahí.
- Deploy, CI, Docker.
- Manejo real de dinero.

Si dedicaste tiempo a algo de la segunda lista, contanos por qué — capaz tenías
una razón que no vimos.

---

## Entrega

Un repo git privado invitándonos con:

- El código.
- Un `README` con **cómo se corre** — asumí que arrancamos de cero.
- El `ENTREGA.md` completo.

**Plazo:** 7 días desde que recibís esto, para que puedas acomodarlo en tu
semana. Si necesitás más tiempo, avisanos y lo movemos. No es una prueba de
resistencia.

Después coordinamos una call de una hora: nos contás qué hiciste, lo miramos
juntos y trabajamos sobre tu código en vivo.

Cualquier duda, escribinos. Éxitos 🚀
