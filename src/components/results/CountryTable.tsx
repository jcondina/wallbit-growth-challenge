import { DataTable } from "@/components/ui/DataTable";
import { Pill } from "@/components/ui/Pill";
import { COUNTRY_CUT_CAVEAT, countryName } from "@/content/copy";
import { formatP, formatPp, formatRatio } from "@/lib/format";
import type { CountryCut } from "@/services/experimentResults";

/** Collapsed by default on the page; every small arm is tagged and the note explains why. */
export function CountryTable({ cuts }: { cuts: CountryCut[] }) {
  if (cuts.length === 0) return <p className="text-sm text-muted">Sin usuarios asignados.</p>;
  const names = Object.keys(cuts[0].variants);
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">{COUNTRY_CUT_CAVEAT}</p>
      <DataTable
        columns={[
          { header: "País" },
          ...names.map((v) => ({ header: `${v} activados`, align: "right" as const })),
          { header: "B − A", align: "right" },
          { header: "p", align: "right" },
        ]}
        rows={cuts.map((c) => [
          <span key={c.country} className="flex items-center gap-2">
            {countryName(c.country)} <span className="font-mono text-xs text-muted">{c.country}</span>
            {c.smallSample ? <Pill tone="warning">muestra chica</Pill> : null}
          </span>,
          ...names.map((v) => formatRatio(c.variants[v].activated, c.variants[v].users)),
          formatPp(c.comparison?.difference ?? null),
          formatP(c.comparison?.test?.p ?? null),
        ])}
        rowClassName={(i) => (cuts[i].smallSample ? "text-muted" : "")}
        caption="«muestra chica» = alguna variante con menos de 30 usuarios en ese país."
      />
    </div>
  );
}
