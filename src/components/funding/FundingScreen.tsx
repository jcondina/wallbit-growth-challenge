"use client";

import { type SyntheticEvent, useEffect, useMemo, useRef, useState } from "react";
import { Disclosure } from "@/components/ui/Disclosure";
import { Page } from "@/components/ui/Page";
import type { Instructions } from "@/content/fundingInstructions";
import { type TrackContext, clientTimeZone, msSince, nowMs, track } from "@/lib/analytics";
import { MethodCard, type MethodView } from "./MethodCard";
import { Ribbon } from "./Ribbon";

/**
 * The funding screen, both variants.
 *
 *   A — every eligible method as an identical card. The sameness is the
 *       control: the user self-diagnoses among all of them.
 *   B — one hero card (the country's recommendation) and the rest behind a
 *       native <details> "Ver otras opciones". Same MethodCard, one prop.
 *
 * This is the only place the variant name is interpreted. Everything the
 * user does here is tracked through lib/analytics.ts unless `tracking` is
 * false (preview renders), with durations measured on the client and
 * timestamps left to the server.
 */

export interface FundingScreenProps {
  user: { id: string; country: string; countryName: string };
  experimentId: string;
  variant: string;
  ribbon: { text: string; tone: "muted" | "warning" };
  tracking: boolean;
  recommended: MethodView;
  /** Eligible methods in catalogue order (includes the recommended one). */
  methods: MethodView[];
  instructions: Record<string, Instructions>;
}

export function FundingScreen(props: FundingScreenProps) {
  const { user, variant, tracking, recommended, methods, instructions } = props;
  const isB = variant === "B";

  const ctx = useMemo<TrackContext>(
    () => ({ userId: user.id, experimentId: props.experimentId, variantShown: variant, enabled: tracking }),
    [user.id, props.experimentId, variant, tracking],
  );

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const viewedAt = useRef<number>(0);
  const selectedAt = useRef<number>(0);
  const selections = useRef(0);
  const lastStep = useRef<"viewed" | "selected" | "copied">("viewed");
  const viewedSent = useRef(false);

  const displayOrder = useMemo(
    () => (isB ? [recommended, ...methods.filter((m) => m.id !== recommended.id)] : methods),
    [isB, recommended, methods],
  );

  useEffect(() => {
    // Exposure, once per mount even under StrictMode's double effect.
    if (!viewedSent.current) {
      viewedSent.current = true;
      viewedAt.current = nowMs();
      track(ctx, "funding_screen_viewed", {
        methods_shown: displayOrder.map((m) => m.id),
        recommended_method_id: isB ? recommended.id : null,
        n_visible: isB ? 1 : displayOrder.length,
        client_tz: clientTimeZone(),
      });
    }
    // Best-effort abandonment signal; sendBeacon survives the unload.
    const onLeave = () =>
      track(ctx, "funding_screen_left", {
        ms_on_screen: msSince(viewedAt.current),
        last_step: lastStep.current,
      });
    window.addEventListener("pagehide", onLeave);
    return () => window.removeEventListener("pagehide", onLeave);
  }, [ctx, displayOrder, isB, recommended.id]);

  const select = (method: MethodView, via: "list" | "primary" | "expanded") => {
    const position = displayOrder.findIndex((m) => m.id === method.id);
    track(ctx, "funding_method_selected", {
      method_id: method.id,
      position,
      is_recommended: isB && method.id === recommended.id,
      via,
      ms_since_view: msSince(viewedAt.current),
      n_selected_before: selections.current,
    });
    selections.current += 1;
    selectedAt.current = nowMs();
    lastStep.current = "selected";
    setSelectedId(method.id);
  };

  const copy = (method: MethodView) => (field: string) => {
    track(ctx, "funding_details_copied", {
      method_id: method.id,
      field,
      ms_since_select: msSince(selectedAt.current),
    });
    lastStep.current = "copied";
  };

  const onOptionsToggle = (e: SyntheticEvent<HTMLDetailsElement>) => {
    if (e.currentTarget.open) {
      track(ctx, "funding_options_expanded", { ms_since_view: msSince(viewedAt.current) });
    }
  };

  const card = (method: MethodView, emphasis: "hero" | "list", via: "list" | "primary" | "expanded") => (
    <MethodCard
      key={method.id}
      method={method}
      emphasis={emphasis}
      recommendedFor={emphasis === "hero" ? user.countryName : undefined}
      selected={selectedId === method.id}
      instructions={instructions[method.id]}
      onSelect={() => select(method, via)}
      onCopy={copy(method)}
    />
  );

  return (
    <Page
      width="narrow"
      lead={<Ribbon text={props.ribbon.text} tone={props.ribbon.tone} />}
      title="Ingresar dinero"
      subtitle={
        isB
          ? `Te recomendamos el método más simple para ${user.countryName}. Copiá los datos y transferí desde tu banco.`
          : "Elegí cómo querés ingresar dólares a tu cuenta. Copiá los datos y transferí desde tu banco o plataforma."
      }
    >
      {isB ? (
        <>
          {card(recommended, "hero", "primary")}
          <Disclosure summary={`Ver otras opciones (${displayOrder.length - 1})`} onToggle={onOptionsToggle}>
            <div className="flex flex-col gap-3">{displayOrder.slice(1).map((m) => card(m, "list", "expanded"))}</div>
          </Disclosure>
        </>
      ) : (
        <div className="flex flex-col gap-3">{displayOrder.map((m) => card(m, "list", "list"))}</div>
      )}
    </Page>
  );
}
