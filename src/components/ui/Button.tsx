import type { ButtonHTMLAttributes } from "react";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary";
  size?: "md" | "sm";
}

export function Button({ variant = "secondary", size = "md", className = "", ...rest }: Props) {
  const look =
    variant === "primary"
      ? "bg-accent text-white hover:opacity-90"
      : "border border-line bg-surface hover:bg-surface-muted";
  const dims = size === "sm" ? "px-3 py-1.5 text-sm" : "px-4 py-2 text-sm";
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-2 rounded-md font-medium transition disabled:opacity-50 ${look} ${dims} ${className}`}
      {...rest}
    />
  );
}
