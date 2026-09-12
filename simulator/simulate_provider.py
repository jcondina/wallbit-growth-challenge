#!/usr/bin/env python3
"""
Simulador del proveedor de pagos de Wallbit (sandbox).

Reproduce los callbacks de acreditación que en producción emite el proveedor
cuando detecta y acredita un depósito. Solo usa la librería estándar de Python
3.8+; no hay nada que instalar.

Uso básico:

    python3 simulate_provider.py --url http://localhost:8000

Ver los eventos sin enviarlos a ningún lado:

    python3 simulate_provider.py --dry-run | head -20

Opciones útiles:

    --path /webhooks/deposits   Ruta del endpoint (default: /webhooks/deposits)
    --delay-ms 150              Pausa entre eventos (default: 120)
    --limit 50                  Enviar solo los primeros N eventos
    --secret <str>              Secreto para la firma HMAC (default: whsec_sandbox_wallbit)
    --no-signature              No mandar el header de firma
    --stop-on-error             Cortar ante la primera respuesta no-2xx

Leé PROVIDER.md antes de implementar el endpoint.
"""

import argparse
import hashlib
import hmac
import json
import os
import sys
import time
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_SCENARIO = os.path.join(HERE, "scenario.json")
DEFAULT_SECRET = "whsec_sandbox_wallbit"


def sign(secret: str, body: bytes) -> str:
    return hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()


def post(url: str, body: bytes, headers: dict, timeout: float = 10.0):
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, resp.read(400).decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read(400).decode("utf-8", "replace")
    except urllib.error.URLError as e:
        return None, f"{e.reason}"
    except Exception as e:  # noqa: BLE001
        return None, str(e)


def main() -> int:
    p = argparse.ArgumentParser(description="Simulador de webhooks del proveedor de pagos")
    p.add_argument("--url", default=None, help="Base URL de tu app, ej. http://localhost:8000")
    p.add_argument("--path", default="/webhooks/deposits")
    p.add_argument("--scenario", default=DEFAULT_SCENARIO)
    p.add_argument("--delay-ms", type=int, default=120)
    p.add_argument("--limit", type=int, default=0)
    p.add_argument("--secret", default=DEFAULT_SECRET)
    p.add_argument("--no-signature", action="store_true")
    p.add_argument("--stop-on-error", action="store_true")
    p.add_argument("--dry-run", action="store_true", help="Imprimir los payloads sin enviarlos")
    args = p.parse_args()

    if not args.dry_run and not args.url:
        p.error("hace falta --url (o usá --dry-run)")

    with open(args.scenario, encoding="utf-8") as f:
        scenario = json.load(f)

    events = scenario["events"]
    if args.limit:
        events = events[: args.limit]

    target = None
    if args.url:
        target = args.url.rstrip("/") + args.path

    print(f"[sim] proveedor : {scenario['provider']} v{scenario['version']}", file=sys.stderr)
    print(f"[sim] entrega   : {scenario['delivery_guarantee']}", file=sys.stderr)
    print(f"[sim] eventos   : {len(events)}", file=sys.stderr)
    if target:
        print(f"[sim] destino   : POST {target}", file=sys.stderr)
    print("", file=sys.stderr)

    ok = err = 0
    for i, event in enumerate(events, start=1):
        body = json.dumps(event, ensure_ascii=False, separators=(",", ":")).encode("utf-8")

        if args.dry_run:
            print(json.dumps(event, ensure_ascii=False))
            continue

        headers = {
            "Content-Type": "application/json",
            "User-Agent": "wallbit-payments-sandbox/1.0",
            "X-Wallbit-Event-Id": event["event_id"],
            "X-Wallbit-Event-Type": event["type"],
        }
        if not args.no_signature:
            headers["X-Wallbit-Signature"] = "sha256=" + sign(args.secret, body)

        status, snippet = post(target, body, headers)
        if status is not None and 200 <= status < 300:
            ok += 1
            mark = "ok "
        else:
            err += 1
            mark = "ERR"

        print(
            f"[{i:>4}/{len(events)}] {mark} {status if status is not None else '---':>4} "
            f"{event['type']:<18} {event['event_id']} {event['data']['deposit_id']}"
            + (f"  <- {snippet[:120]}" if mark == "ERR" else ""),
            file=sys.stderr,
        )

        if mark == "ERR" and args.stop_on_error:
            print("\n[sim] corte por --stop-on-error", file=sys.stderr)
            return 1

        if args.delay_ms:
            time.sleep(args.delay_ms / 1000.0)

    if not args.dry_run:
        print(f"\n[sim] terminado. 2xx: {ok}  errores: {err}", file=sys.stderr)
        print("[sim] recordá: la entrega es at-least-once.", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
