#!/usr/bin/env python3
"""
Independent recomputation of the experiment result.

Reads the raw material (data/*.json, simulator/scenario.json) and recomputes
eligibility, deduplication, deposit state, activation and the variant split
with plain loops — sharing no code with the app — then compares against
GET /api/results and prints MATCH or the differences.

    python3 scripts/verify.py                # app at http://localhost:3000
    python3 scripts/verify.py --url http://localhost:3001
    python3 scripts/verify.py --offline      # only print the independent numbers

Only the standard library is used (like the simulator).
"""

import argparse
import hashlib
import json
import os
import sys
import urllib.error
import urllib.request
from collections import defaultdict
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXPERIMENT_ID = "funding_recommended_v1"
STARTS_AT = datetime(2026, 8, 1, tzinfo=timezone.utc)
WINDOW = timedelta(hours=168)


def instant(s: str) -> datetime:
    # The material only uses this exact shape; anything else is a bug worth crashing on.
    return datetime.strptime(s, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)


def load(rel: str):
    with open(os.path.join(ROOT, rel), encoding="utf-8") as f:
        return json.load(f)


def bucket(user_id: str) -> int:
    return int(hashlib.sha256(f"{EXPERIMENT_ID}:{user_id}".encode()).hexdigest()[:8], 16) % 100


def variant_for(user_id: str, allocation) -> str:
    b = bucket(user_id)
    cumulative = 0
    for entry in allocation:
        cumulative += entry["weight"]
        if b < cumulative:
            return entry["variant"]
    return allocation[-1]["variant"]


def activated(created_at: datetime, first_completed: datetime | None) -> bool:
    return first_completed is not None and created_at <= first_completed <= created_at + WINDOW


def recompute(allocation):
    users = {u["id"]: u for u in load("data/users.json")}
    historical = load("data/deposits_historicos.json")
    deliveries = load("simulator/scenario.json")["events"]

    # --- dedupe deliveries by event_id, fold deposits by deposit_id ---------
    seen = set()
    duplicates = 0
    deposits = {}
    pairs = defaultdict(set)  # (deposit_id, type) -> event_ids
    for e in deliveries:
        if e["event_id"] in seen:
            duplicates += 1
            continue
        seen.add(e["event_id"])
        d = e["data"]
        kind = e["type"].split(".")[1]
        pairs[(d["deposit_id"], kind)].add(e["event_id"])
        at = instant(e["occurred_at"])
        st = deposits.setdefault(d["deposit_id"], {"user": d["user_id"], "received": None, "completed": None, "failed": None})
        if st[kind] is None or at < st[kind]:
            st[kind] = at
    resends = sum(1 for ids in pairs.values() if len(ids) > 1)

    def status(st):
        if st["completed"] and st["failed"]:
            return "conflict"
        if st["completed"]:
            return "completed"
        if st["failed"]:
            return "failed"
        return "received"

    by_status = defaultdict(int)
    for st in deposits.values():
        by_status[status(st)] += 1

    # --- first credited deposit per user (webhook + historical) --------------
    first_completed = {}
    first_initiated = {}
    for st in deposits.values():
        if status(st) == "completed":
            u = st["user"]
            if u not in first_completed or st["completed"] < first_completed[u]:
                first_completed[u] = st["completed"]
                first_initiated[u] = st["received"]
    for h in historical:
        u = h["user_id"]
        at = instant(h["completed_at"])
        if u not in first_completed or at < first_completed[u]:
            first_completed[u] = at
            first_initiated[u] = instant(h["created_at"])

    # --- experiment cohort ----------------------------------------------------
    variants = defaultdict(lambda: {"users": 0, "activated": 0, "lateConversions": 0, "everConverted": 0})
    for u in users.values():
        created = instant(u["created_at"])
        if created < STARTS_AT:
            continue
        v = variants[variant_for(u["id"], allocation)]
        v["users"] += 1
        fc = first_completed.get(u["id"])
        if activated(created, fc):
            v["activated"] += 1
        if fc is not None:
            v["everConverted"] += 1
            if not activated(created, fc):
                v["lateConversions"] += 1

    # --- baseline cohort ------------------------------------------------------
    baseline = {"users": 0, "activated": 0, "initiatedInWindow": 0, "everConverted": 0}
    for u in users.values():
        created = instant(u["created_at"])
        if created >= STARTS_AT:
            continue
        baseline["users"] += 1
        fc = first_completed.get(u["id"])
        if activated(created, fc):
            baseline["activated"] += 1
        if fc is not None:
            baseline["everConverted"] += 1
            fi = first_initiated.get(u["id"])
            if fi is not None and created <= fi <= created + WINDOW:
                baseline["initiatedInWindow"] += 1

    return {
        "variants": dict(variants),
        "baseline": baseline,
        "inbox": {"uniqueEvents": len(seen), "duplicates": duplicates, "resends": resends},
        "deposits": {"total": len(deposits), **{k: by_status.get(k, 0) for k in ("completed", "failed", "conflict", "received")}},
    }


def fetch(url: str):
    req = urllib.request.Request(url + "/api/results", headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.load(resp)


def flatten_app(api):
    out = {"variants": {}, "baseline": {}, "inbox": {}, "deposits": {}}
    for name, g in api["variants"].items():
        out["variants"][name] = {k: g[k] for k in ("users", "activated", "lateConversions", "everConverted")}
    out["baseline"] = {k: api["baseline"][k] for k in ("users", "activated", "initiatedInWindow", "everConverted")}
    dq = api["dataQuality"]
    out["inbox"] = {"uniqueEvents": dq["inbox"]["uniqueEvents"], "duplicates": dq["duplicatesIgnored"], "resends": dq["inbox"]["resends"]}
    out["deposits"] = {k: dq["deposits"][k] for k in ("total", "completed", "failed", "conflict", "received")}
    return out


def rows(d, prefix=""):
    for k, v in d.items():
        if isinstance(v, dict):
            yield from rows(v, f"{prefix}{k}.")
        else:
            yield f"{prefix}{k}", v


def main() -> int:
    p = argparse.ArgumentParser(description="Recompute the experiment result independently and compare with /api/results")
    p.add_argument("--url", default="http://localhost:3000")
    p.add_argument("--offline", action="store_true", help="print the independent numbers without calling the app")
    args = p.parse_args()

    allocation = [{"variant": "A", "weight": 50}, {"variant": "B", "weight": 50}]
    api = None
    if not args.offline:
        try:
            api = fetch(args.url)
            allocation = api["experiment"]["allocation"]
        except (urllib.error.URLError, OSError) as e:
            print(f"app not reachable at {args.url} ({e}); showing independent numbers only", file=sys.stderr)

    mine = recompute(allocation)

    if api is None:
        for k, v in rows(mine):
            print(f"  {k:32} {v}")
        return 2

    flat = flatten_app(api)
    theirs = dict(rows(flat))
    mismatches = 0
    print(f"  {'metric':32} {'app':>8} {'independent':>12}")
    for k, v_mine in sorted(rows(mine)):
        v_app = theirs.get(k, "missing")
        ok = v_mine == v_app
        mismatches += 0 if ok else 1
        print(f"  {k:32} {str(v_app):>8} {v_mine:>12}  {'ok' if ok else '<-- MISMATCH'}")

    a = flat["variants"].get("A", {})
    b = flat["variants"].get("B", {})
    if a and b:
        print(f"\n  A {a['activated']}/{a['users']} = {100 * a['activated'] / a['users']:.1f} %   "
              f"B {b['activated']}/{b['users']} = {100 * b['activated'] / b['users']:.1f} %   "
              f"verdict: {api['verdict']['state'] if api.get('verdict') else 'n/a'}")

    print("\n  MATCH" if mismatches == 0 else f"\n  MISMATCH ({mismatches} field{'s' if mismatches != 1 else ''})")
    return 0 if mismatches == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
