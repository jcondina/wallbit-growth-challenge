import type { ReactNode } from "react";

interface Props {
  label: ReactNode;
  value: ReactNode;
  /** The "k / n" line or an interval — the value never stands alone. */
  sub?: ReactNode;
}

export function Stat({ label, value, sub }: Props) {
  return (
    <div className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
      <div className="text-sm text-muted">{label}</div>
      <div className="mt-1 text-3xl font-semibold tracking-tight">{value}</div>
      {sub ? <div className="mt-1 text-sm text-muted">{sub}</div> : null}
    </div>
  );
}
