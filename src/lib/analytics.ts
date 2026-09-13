"use client";

import type { ClientEventName, EventProps } from "@/domain/events";

/**
 * Browser-side tracking. Fire-and-forget: nothing here can block or break
 * the screen. Every event gets a uuid so the server can deduplicate, and a
 * per-tab session id so a funnel can be reconstructed. The client clock is
 * sent for diagnostics only; the server stamps the timestamp.
 */

export interface TrackContext {
  userId: string;
  experimentId: string;
  variantShown: string;
  /** Preview renders emit nothing. */
  enabled: boolean;
}

const SESSION_KEY = "wallbit.session";

export function sessionId(): string {
  try {
    const existing = sessionStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const fresh = crypto.randomUUID();
    sessionStorage.setItem(SESSION_KEY, fresh);
    return fresh;
  } catch {
    return "no-storage";
  }
}

/** Monotonic clock for on-screen durations (immune to a wrong wall clock). */
export function nowMs(): number {
  return performance.now();
}

export function msSince(startMs: number): number {
  return Math.round(performance.now() - startMs);
}

export function clientTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
  } catch {
    return null;
  }
}

export function track<N extends ClientEventName>(ctx: TrackContext, name: N, props: EventProps<N>): void {
  if (!ctx.enabled) return;
  const payload = JSON.stringify({
    event_id: crypto.randomUUID(),
    name,
    user_id: ctx.userId,
    experiment_id: ctx.experimentId,
    variant_shown: ctx.variantShown,
    session_id: sessionId(),
    client_sent_at: new Date().toISOString(),
    props,
  });

  // sendBeacon survives page unloads (needed for funding_screen_left); a
  // Blob with a JSON type keeps the request same-origin-simple.
  try {
    if (typeof navigator.sendBeacon === "function") {
      if (navigator.sendBeacon("/api/track", new Blob([payload], { type: "application/json" }))) return;
    }
  } catch {
    // fall through to fetch
  }
  void fetch("/api/track", { method: "POST", body: payload, headers: { "content-type": "application/json" }, keepalive: true }).catch(
    () => undefined,
  );
}
