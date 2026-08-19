import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface Column<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  align?: "left" | "right";
  /** Column is dropped below this breakpoint to keep narrow screens readable. */
  hideBelow?: "sm" | "md" | "lg" | "xl";
  className?: string;
}

/** Static strings so Tailwind can see the class names at build time. */
const HIDE_BELOW: Record<NonNullable<Column<unknown>["hideBelow"]>, string> = {
  sm: "hidden sm:table-cell",
  md: "hidden md:table-cell",
  lg: "hidden lg:table-cell",
  xl: "hidden xl:table-cell",
};

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  getRowKey: (row: T) => string;
  caption?: string;
  empty?: ReactNode;
  className?: string;
}

export function DataTable<T>({
  columns,
  rows,
  getRowKey,
  caption,
  empty,
  className,
}: DataTableProps<T>) {
  if (rows.length === 0 && empty) {
    return (
      <div
        className={cn(
          "rounded-xl border border-line bg-surface shadow-card",
          className,
        )}
      >
        {empty}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "overflow-x-auto rounded-xl border border-line bg-surface shadow-card scrollbar-slim",
        className,
      )}
    >
      <table className="w-full min-w-[640px] border-collapse text-sm">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead>
          <tr className="border-b border-line bg-surface-muted">
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={cn(
                  "px-4 py-2.5 text-[11.5px] font-semibold uppercase tracking-wide text-ink-subtle",
                  column.align === "right" ? "text-right" : "text-left",
                  column.hideBelow && HIDE_BELOW[column.hideBelow],
                  column.className,
                )}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={getRowKey(row)}
              className="border-b border-line last:border-b-0 transition-colors hover:bg-surface-muted/60"
            >
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={cn(
                    "px-4 py-3 align-middle text-ink",
                    column.align === "right" ? "text-right" : "text-left",
                    column.hideBelow && HIDE_BELOW[column.hideBelow],
                    column.className,
                  )}
                >
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
