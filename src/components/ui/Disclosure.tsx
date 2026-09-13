import type { ReactNode, SyntheticEvent } from "react";

interface Props {
  summary: ReactNode;
  children: ReactNode;
  /** Same name on several disclosures makes them exclusive (native accordion). */
  name?: string;
  defaultOpen?: boolean;
  /** Only usable from client components (functions cannot cross the server boundary). */
  onToggle?: (event: SyntheticEvent<HTMLDetailsElement>) => void;
}

/** Native <details>/<summary>: keyboard-accessible, no JS needed to open. */
export function Disclosure({ summary, children, name, defaultOpen, onToggle }: Props) {
  return (
    <details
      name={name}
      open={defaultOpen}
      onToggle={onToggle}
      className="group rounded-[var(--radius-card)] border border-line bg-surface open:bg-surface"
    >
      <summary className="px-5 py-3 text-sm font-medium select-none">{summary}</summary>
      <div className="border-t border-line px-5 py-4">{children}</div>
    </details>
  );
}
