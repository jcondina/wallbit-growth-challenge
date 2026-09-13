import type { ReactNode } from "react";

export interface Column {
  header: ReactNode;
  align?: "left" | "right";
}

interface Props {
  columns: Column[];
  rows: ReactNode[][];
  caption?: ReactNode;
  /** Optional per-row emphasis (e.g. a small-sample warning). */
  rowClassName?: (rowIndex: number) => string;
}

/** Semantic table: <th scope="col">, numeric columns right-aligned, tabular figures inherited from body. */
export function DataTable({ columns, rows, caption, rowClassName }: Props) {
  const align = (c: Column) => (c.align === "right" ? "text-right" : "text-left");
  return (
    <div className="overflow-x-auto rounded-[var(--radius-card)] border border-line bg-surface">
      <table className="w-full text-sm">
        {caption ? <caption className="px-4 py-3 text-left text-xs text-muted">{caption}</caption> : null}
        <thead>
          <tr className="border-b border-line bg-surface-muted text-xs uppercase tracking-wide text-muted">
            {columns.map((c, i) => (
              <th key={i} scope="col" className={`px-4 py-2 font-medium ${align(c)}`}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((cells, r) => (
            <tr key={r} className={`border-b border-line last:border-b-0 ${rowClassName?.(r) ?? ""}`}>
              {cells.map((cell, i) => (
                <td key={i} className={`px-4 py-2 ${align(columns[i])}`}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
