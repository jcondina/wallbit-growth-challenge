import type { ReactNode } from "react";
import type { Tone } from "./Pill";

const tones: Record<Tone, string> = {
  neutral: "border-line bg-surface-muted",
  accent: "border-accent bg-accent-soft",
  success: "border-success bg-success-soft",
  warning: "border-warning bg-warning-soft",
  danger: "border-danger bg-danger-soft",
};

interface Props {
  tone?: Tone;
  title?: ReactNode;
  children: ReactNode;
}

export function Callout({ tone = "neutral", title, children }: Props) {
  return (
    <div className={`rounded-[var(--radius-card)] border-l-4 border px-5 py-4 ${tones[tone]}`}>
      {title ? <div className="mb-1 font-semibold">{title}</div> : null}
      <div className="text-sm leading-relaxed">{children}</div>
    </div>
  );
}
