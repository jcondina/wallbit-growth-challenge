# Wallbit Payments — Webhooks (sandbox)

Documentación del proveedor de pagos que notifica las acreditaciones de
depósitos.

---

## Cómo funciona

Cuando un usuario transfiere dinero a su cuenta de Wallbit, la operación no
ocurre dentro de la app: el usuario copia los datos de la cuenta destino y hace
la transferencia desde su banco, wallet o plataforma de terceros. El dinero
llega minutos, horas o días después.

Tu backend se entera **únicamente** por estos webhooks.

## El endpoint

Exponés un endpoint HTTP que recibe `POST` con `Content-Type: application/json`.
Por defecto el simulador apunta a `/webhooks/deposits`; podés cambiarlo con
`--path`.

Respondé `2xx` cuando hayas recibido el evento. Cualquier otra cosa —o un
timeout— cuenta como fallo de entrega.

## Formato del evento

```json
{
  "event_id": "evt_000123",
  "type": "deposit.completed",
  "occurred_at": "2026-08-04T17:22:31Z",
  "data": {
    "deposit_id": "dep_100042",
    "user_id": "usr_000871",
    "method_id": "local_ar",
    "amount_usd": 412.55,
    "currency": "ARS",
    "country": "AR"
  }
}
```

Headers que acompañan cada request:

| Header | Contenido |
|---|---|
| `X-Wallbit-Event-Id` | Igual a `event_id` |
| `X-Wallbit-Event-Type` | Igual a `type` |
| `X-Wallbit-Signature` | `sha256=<hex>` — HMAC-SHA256 del body crudo |

El secreto del sandbox es `whsec_sandbox_wallbit`. Verificar la firma es
**opcional** para este ejercicio.

## Tipos de evento

| Tipo | Significado |
|---|---|
| `deposit.received` | Detectamos fondos entrantes asociados al usuario. **La operación todavía puede fallar.** |
| `deposit.completed` | Los fondos quedaron acreditados en la cuenta. Estado final. |
| `deposit.failed` | La operación fue rechazada (nombre del titular que no coincide, fondos de terceros, origen no permitido). Estado final. |

Un depósito rechazado no se reintenta sobre el mismo `deposit_id`: si el
usuario vuelve a transferir, se genera un `deposit_id` nuevo.

## Garantías de entrega — leer antes de implementar

**1. La entrega es _at-least-once_.**
Si tu endpoint no responde `2xx` a tiempo, reintentamos. También reintentamos
ante fallos de red de nuestro lado, incluso cuando vos ya procesaste el evento.
Un mismo `event_id` puede llegarte **más de una vez**.

**2. Un mismo `deposit_id` puede aparecer bajo distintos `event_id`.**
Ante incidentes o pedidos de soporte reenviamos eventos con un `event_id`
nuevo. Para determinar el estado de un depósito usá `deposit_id` + `type`, no
`event_id`.

**3. No garantizamos el orden.**
Los eventos pueden llegarte desordenados respecto de `occurred_at`. En
particular, un `deposit.completed` puede llegar antes que el
`deposit.received` del mismo depósito.

**4. `occurred_at` es la hora del hecho, no la de entrega.**
Siempre en UTC. Usalo para cualquier cálculo temporal; el momento en que tu
servidor recibe el request no es información confiable.

## Probar sin escribir código

```bash
python3 simulate_provider.py --dry-run | head -20
```

## Reproducir contra tu app

```bash
python3 simulate_provider.py --url http://localhost:8000
```

El simulador es determinista: emite siempre los mismos eventos en el mismo
orden. Podés correrlo tantas veces como quieras — pero ojo, correrlo dos veces
equivale a que el proveedor te reenvíe todo, y tus números no deberían cambiar
por eso.
