/** One mono line that says exactly what this render is — the brief's "dejar claro qué ve cada usuario". */
export function Ribbon({ text, tone = "muted" }: { text: string; tone?: "muted" | "warning" }) {
  const color = tone === "warning" ? "text-warning" : "text-muted";
  return (
    <p className={`mb-6 border-b border-line pb-3 font-mono text-xs ${color}`} data-testid="ribbon">
      {text}
    </p>
  );
}
