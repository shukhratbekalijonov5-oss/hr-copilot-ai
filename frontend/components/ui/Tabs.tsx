"use client";

import { useId, useState } from "react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface TabItem {
  id: string;
  label: string;
  badge?: ReactNode;
  content: ReactNode;
}

interface TabsProps {
  items: TabItem[];
  defaultTabId?: string;
  /** Accessible name for the tab list. Supplied translated by the caller. */
  label: string;
  className?: string;
  listClassName?: string;
}

export function Tabs({
  items,
  defaultTabId,
  label,
  className,
  listClassName,
}: TabsProps) {
  const baseId = useId();
  const [activeId, setActiveId] = useState(defaultTabId ?? items[0]?.id);
  const active = items.find((item) => item.id === activeId) ?? items[0];

  return (
    <div className={className}>
      <div
        role="tablist"
        aria-label={label}
        className={cn(
          "flex gap-1 overflow-x-auto border-b border-line scrollbar-slim",
          listClassName,
        )}
      >
        {items.map((item) => {
          const selected = item.id === active?.id;
          return (
            <button
              key={item.id}
              role="tab"
              type="button"
              id={`${baseId}-${item.id}-tab`}
              aria-selected={selected}
              aria-controls={`${baseId}-${item.id}-panel`}
              onClick={() => setActiveId(item.id)}
              className={cn(
                "-mb-px shrink-0 border-b-2 px-3 py-2.5 text-[13px] font-medium transition-colors",
                selected
                  ? "border-brand text-ink"
                  : "border-transparent text-ink-muted hover:text-ink",
              )}
            >
              <span className="inline-flex items-center gap-1.5">
                {item.label}
                {item.badge}
              </span>
            </button>
          );
        })}
      </div>

      {active ? (
        <div
          role="tabpanel"
          id={`${baseId}-${active.id}-panel`}
          aria-labelledby={`${baseId}-${active.id}-tab`}
          tabIndex={0}
          className="pt-4 focus-visible:outline-none"
        >
          {active.content}
        </div>
      ) : null}
    </div>
  );
}
