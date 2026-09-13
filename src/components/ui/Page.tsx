import type { ReactNode } from "react";

interface Props {
  title: string;
  subtitle?: ReactNode;
  /** narrow = a phone-sized product screen; wide = a dashboard */
  width?: "narrow" | "wide";
  /** Slot above the title (ribbon, breadcrumbs). */
  lead?: ReactNode;
  children: ReactNode;
}

export function Page({ title, subtitle, width = "wide", lead, children }: Props) {
  return (
    <main className={`mx-auto w-full px-5 py-10 ${width === "narrow" ? "max-w-[560px]" : "max-w-[880px]"}`}>
      {lead}
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle ? <p className="mt-2 text-sm text-muted">{subtitle}</p> : null}
      </header>
      <div className="flex flex-col gap-10">{children}</div>
    </main>
  );
}
