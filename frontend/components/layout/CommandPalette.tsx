"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { SearchIcon } from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";
import {
  commandsFor,
  filterCommands,
  groupCommands,
  moveActiveIndex,
  OPEN_PALETTE_EVENT,
} from "@/lib/command/palette";
import type { Workspace } from "@/lib/workspace/types";

/**
 * ⌘K — jump anywhere this account can already go.
 *
 * ## Keyboard-first, and correct about it
 *
 * The input keeps focus for the whole session; arrows move a virtual
 * selection rather than DOM focus, which is the `combobox` + `listbox`
 * pattern screen readers expect. `aria-activedescendant` points at the
 * highlighted row so the selection is announced without the focus ring ever
 * leaving the text field.
 *
 * ## It only offers doors the bar already shows
 *
 * Commands are derived from `navigationFor`, so role filtering is inherited
 * rather than reimplemented — an interviewer gets no Compare command because
 * they have no Compare link. The palette makes no request of any kind.
 */
export function CommandPalette({ workspace }: { workspace: Workspace }) {
  const router = useRouter();
  const { d } = useI18n();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const baseId = useId();

  const commands = useMemo(
    () => commandsFor(workspace, d),
    [workspace, d],
  );
  const results = useMemo(
    () => filterCommands(commands, query),
    [commands, query],
  );
  const groups = useMemo(() => groupCommands(results), [results]);

  // The shortcut, and only the shortcut, at the document level.
  useEffect(() => {
    function reset() {
      setQuery("");
      setActive(0);
    }

    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
        reset();
      }
    }
    function onOpenRequest() {
      setOpen(true);
      reset();
    }

    document.addEventListener("keydown", onKeyDown);
    window.addEventListener(OPEN_PALETTE_EVENT, onOpenRequest);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener(OPEN_PALETTE_EVENT, onOpenRequest);
    };
  }, []);

  /*
   * Focus follows the open state. Focusing a DOM node is a genuine external
   * side effect, unlike setState — the query reset that used to live here
   * moved into the events that open the palette, where it belongs.
   */
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  if (!open) return null;

  const flat = groups.flatMap((group) => group.commands);
  const activeId = flat[active] ? `${baseId}-${flat[active].id}` : undefined;

  function go(href: string) {
    setOpen(false);
    router.push(href);
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setActive((current) =>
        moveActiveIndex(current, event.key === "ArrowDown" ? 1 : -1, flat.length),
      );
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const target = flat[active];
      if (target) go(target.href);
    }
  }

  let index = -1;

  return (
    <div
      className="animate-fade-in fixed inset-0 z-[60] flex items-start justify-center bg-ink/45 p-4 pt-[12vh] backdrop-blur-[3px]"
      role="presentation"
      onClick={() => setOpen(false)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={d.palette.title}
        onClick={(event) => event.stopPropagation()}
        className="animate-pop-in w-full max-w-lg overflow-hidden rounded-[16px] border border-line bg-surface shadow-pop"
      >
        <div className="flex items-center gap-2.5 border-b border-line px-4">
          <SearchIcon className="size-4 shrink-0 text-ink-subtle" aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls={`${baseId}-list`}
            aria-activedescendant={activeId}
            aria-autocomplete="list"
            aria-label={d.palette.placeholder}
            placeholder={d.palette.placeholder}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            className="h-12 w-full bg-transparent text-[14px] text-ink placeholder:text-ink-subtle focus:outline-none"
          />
          <kbd className="hidden shrink-0 rounded-[6px] border border-line bg-surface-muted px-1.5 py-0.5 text-[11px] font-medium text-ink-subtle sm:block">
            Esc
          </kbd>
        </div>

        <div
          id={`${baseId}-list`}
          role="listbox"
          aria-label={d.palette.title}
          className="max-h-[min(24rem,50dvh)] overflow-y-auto p-1.5 scrollbar-slim"
        >
          {flat.length === 0 ? (
            <p className="px-3 py-8 text-center text-[13px] text-ink-muted">
              {d.palette.empty}
            </p>
          ) : (
            groups.map((group) => (
              <section key={group.group} className="mb-1 last:mb-0">
                <p className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-subtle">
                  {group.group}
                </p>
                {group.commands.map((command) => {
                  index += 1;
                  const selected = index === active;
                  const position = index;

                  return (
                    <div
                      key={command.id}
                      id={`${baseId}-${command.id}`}
                      role="option"
                      aria-selected={selected}
                      onMouseEnter={() => setActive(position)}
                      onClick={() => go(command.href)}
                      className={cn(
                        "flex cursor-pointer items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-[13.5px]",
                        "transition-colors duration-[var(--motion-fast)]",
                        selected
                          ? "bg-brand-soft text-brand-ink"
                          : "text-ink-muted",
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {command.label}
                      </span>
                    </div>
                  );
                })}
              </section>
            ))
          )}
        </div>

        <p className="border-t border-line px-4 py-2 text-[11.5px] text-ink-subtle">
          {d.palette.hint}
        </p>
      </div>
    </div>
  );
}
