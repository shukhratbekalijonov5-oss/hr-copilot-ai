"use client";

import { useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The tool picker inside the AI Tools area.
 *
 * ## Why one tool at a time
 *
 * Three generated documents stacked in a drawer is a scroll nobody reads.
 * Each tool is a distinct job — explain the ranking, write a letter, prepare
 * for an interview — and a reader wants one of them at a time. Adding the
 * fourth (Advanced Match Breakdown) is one entry in the array a caller passes;
 * nothing in this file or its callers needs to change shape.
 *
 * ## Real tabs, with the keyboard behaviour that implies
 *
 * `role="tablist"` is a promise about arrow keys, and a widget that takes the
 * role without honouring it is worse than one that never claimed it — a
 * screen-reader user is told to press Right and nothing happens. So: roving
 * tabindex (one tab in the sequence, arrows move between them), Home and End,
 * and `aria-controls` pointing at the panel.
 *
 * ## Switching tabs generates nothing
 *
 * This component holds no request and calls nothing. Each tool panel keeps its
 * own state and starts work only when its own button is pressed, so moving
 * between tabs is free — which is the property that makes a tab strip safe to
 * put in front of paid model calls at all.
 */

export interface AiTool {
  id: string;
  label: string;
  panel: ReactNode;
}

export function AiToolTabs({
  tools,
  activeId,
  onSelect,
  idPrefix,
}: {
  tools: AiTool[];
  activeId: string;
  onSelect: (id: string) => void;
  /** Namespaces the tab/panel ids, so two strips on a page cannot collide. */
  idPrefix: string;
}) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  const tabId = (id: string) => `${idPrefix}-tab-${id}`;
  const panelId = (id: string) => `${idPrefix}-panel-${id}`;

  function move(event: React.KeyboardEvent, index: number) {
    const last = tools.length - 1;
    let next: number | null = null;

    if (event.key === "ArrowRight") next = index === last ? 0 : index + 1;
    else if (event.key === "ArrowLeft") next = index === 0 ? last : index - 1;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = last;
    if (next === null) return;

    event.preventDefault();
    const target = tools[next];
    onSelect(target.id);
    // Focus follows selection, which is the expected behaviour for tabs whose
    // panels are cheap to show — and these are: switching renders state that
    // already exists and starts no work.
    refs.current[target.id]?.focus();
  }

  const active = tools.find((tool) => tool.id === activeId) ?? tools[0];

  return (
    <div className="flex flex-col gap-3">
      <div
        role="tablist"
        // Horizontal is the default, but stating it is what tells a screen
        // reader which arrow keys to suggest.
        aria-orientation="horizontal"
        /*
         * Scrolls sideways rather than wrapping: three localized labels do not
         * fit 320px, and a tab strip that wraps into two rows stops reading as
         * a strip.
         */
        className="flex w-full gap-1 overflow-x-auto rounded-lg border border-line bg-surface p-1"
      >
        {tools.map((tool, index) => {
          const selected = tool.id === active.id;
          return (
            <button
              key={tool.id}
              ref={(node) => {
                refs.current[tool.id] = node;
              }}
              type="button"
              role="tab"
              id={tabId(tool.id)}
              aria-selected={selected}
              aria-controls={panelId(tool.id)}
              // Roving tabindex: Tab reaches the strip once, arrows move
              // within it. Every tab being tabbable would make a keyboard
              // reader walk past all of them to reach the panel.
              tabIndex={selected ? 0 : -1}
              onClick={() => onSelect(tool.id)}
              onKeyDown={(event) => move(event, index)}
              className={cn(
                "whitespace-nowrap rounded-md px-3 py-1.5 text-[12.5px] font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
                selected
                  ? "bg-brand-soft text-brand-ink"
                  : "text-ink-muted hover:bg-surface-muted hover:text-ink",
              )}
            >
              {tool.label}
            </button>
          );
        })}
      </div>

      {/*
        Only the active panel is mounted. An inactive tool's state is discarded
        with it, which is correct: its generated document belonged to a
        question the reader has moved on from, and keeping every panel mounted
        would leave three of them listening for answers nobody is waiting for.
      */}
      <div
        role="tabpanel"
        id={panelId(active.id)}
        aria-labelledby={tabId(active.id)}
        tabIndex={0}
        className="focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        {active.panel}
      </div>
    </div>
  );
}
