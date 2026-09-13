import { formatPct, formatPctRange } from "@/lib/format";

export interface CIRow {
  label: string;
  rate: number | null;
  ci: [number, number] | null;
}

/**
 * The only visual on the dashboard: one range bar per variant on a shared
 * axis, point estimate as a tick. It exists so "these intervals overlap"
 * is visible to a reader who will not parse "−13,9 a +1,4 pp".
 */
export function CIBar({ rows }: { rows: CIRow[] }) {
  const cis = rows.flatMap((r) => (r.ci ? [r.ci] : []));
  if (cis.length === 0) return null;
  // axis padded to the nearest 5 % beyond every interval
  const lo = Math.max(0, Math.floor((Math.min(...cis.map((c) => c[0])) * 100 - 2) / 5) * 5);
  const hi = Math.min(100, Math.ceil((Math.max(...cis.map((c) => c[1])) * 100 + 2) / 5) * 5);
  const pos = (v: number) => `${((v * 100 - lo) / (hi - lo)) * 100}%`;
  const ticks = Array.from({ length: (hi - lo) / 5 + 1 }, (_, i) => lo + i * 5);

  return (
    <div className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
      <div className="flex flex-col gap-3">
        {rows.map((r) => (
          <div key={r.label} className="grid grid-cols-[3.5rem_1fr_11rem] items-center gap-3 text-sm">
            <span className="font-medium">{r.label}</span>
            <div className="relative h-5">
              <div className="absolute inset-y-0 left-0 right-0 my-auto h-px bg-line" />
              {r.ci && r.rate !== null ? (
                <>
                  <div
                    className="absolute inset-y-0 my-auto h-2.5 rounded-full bg-accent-soft"
                    style={{ left: pos(r.ci[0]), width: `calc(${pos(r.ci[1])} - ${pos(r.ci[0])})` }}
                    aria-hidden
                  />
                  <div className="absolute inset-y-0 my-auto h-4 w-0.5 bg-accent" style={{ left: pos(r.rate) }} aria-hidden />
                </>
              ) : null}
            </div>
            <span className="text-right text-muted">
              {formatPct(r.rate)} · {formatPctRange(r.ci)}
            </span>
          </div>
        ))}
        <div className="grid grid-cols-[3.5rem_1fr_11rem] gap-3 text-xs text-muted">
          <span />
          <div className="relative h-4">
            {ticks.map((t) => (
              <span key={t} className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: pos(t / 100) }}>
                {t} %
              </span>
            ))}
          </div>
          <span />
        </div>
      </div>
    </div>
  );
}
