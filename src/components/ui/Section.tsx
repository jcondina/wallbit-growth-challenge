import type { ReactNode } from "react";

interface Props {
  title: string;
  description?: ReactNode;
  children: ReactNode;
}

export function Section({ title, description, children }: Props) {
  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}
