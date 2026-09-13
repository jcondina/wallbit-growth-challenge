"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * One bar, every route. Client-side only for the "current page" highlight;
 * links do not prefetch because a prefetched funding page would enroll or
 * track a user the visitor never opened.
 */
const ROUTES: { href: string; label: string; match: (p: string) => boolean }[] = [
  { href: "/", label: "Usuarios", match: (p) => p === "/" || p.startsWith("/u/") },
  { href: "/results", label: "Resultados", match: (p) => p.startsWith("/results") },
  { href: "/funnel", label: "Embudo", match: (p) => p.startsWith("/funnel") },
  { href: "/simulate", label: "Simulador", match: (p) => p.startsWith("/simulate") },
  { href: "/admin", label: "Kill switch", match: (p) => p.startsWith("/admin") },
];

const API = [
  { href: "/api/results", label: "results.json" },
  { href: "/api/funnel", label: "funnel.json" },
  { href: "/api/health", label: "health" },
];

export function SiteNav() {
  const pathname = usePathname() ?? "/";
  return (
    <nav aria-label="Secciones" className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-[880px] flex-wrap items-center gap-x-1 gap-y-1 px-5 py-2 text-sm">
        <Link href="/" prefetch={false} className="mr-3 font-semibold tracking-tight">
          Wallbit · experimento
        </Link>
        {ROUTES.map((r) => {
          const active = r.match(pathname);
          return (
            <Link
              key={r.href}
              href={r.href}
              prefetch={false}
              aria-current={active ? "page" : undefined}
              className={`rounded-md px-2.5 py-1 ${active ? "bg-surface-muted font-medium" : "text-muted hover:bg-surface-muted hover:text-text"}`}
            >
              {r.label}
            </Link>
          );
        })}
        <span className="ml-auto flex items-center gap-2 font-mono text-xs text-muted">
          {API.map((a) => (
            <a key={a.href} href={a.href} className="hover:text-text">
              {a.label}
            </a>
          ))}
        </span>
      </div>
    </nav>
  );
}
