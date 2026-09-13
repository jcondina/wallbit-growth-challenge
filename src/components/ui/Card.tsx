import type { ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** accent = a highlighted card (variant B's recommendation) */
  emphasis?: "default" | "accent";
  className?: string;
}

export function Card({ children, emphasis = "default", className = "" }: Props) {
  const border = emphasis === "accent" ? "border-accent ring-1 ring-accent" : "border-line";
  return <div className={`rounded-[var(--radius-card)] border bg-surface p-5 ${border} ${className}`}>{children}</div>;
}
