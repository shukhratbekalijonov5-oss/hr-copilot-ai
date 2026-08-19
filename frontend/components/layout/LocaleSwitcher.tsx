"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setLocaleAction } from "@/lib/i18n/actions";
import { useI18n } from "@/lib/i18n/context";
import { LOCALES, LOCALE_META, type Locale } from "@/lib/i18n/locales";
import { CheckIcon, GlobeIcon, SpinnerIcon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

/**
 * Language selector.
 *
 * Each language is listed in itself — a reader looking for their own language
 * should not have to read the current one to find it. Choosing writes the one
 * locale cookie and revalidates the tree, so the interface *and* the language
 * every subsequent AI generation request asks for change together.
 */
export function LocaleSwitcher({ className }: { className?: string }) {
  const { locale, d } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  function choose(next: Locale) {
    setOpen(false);
    if (next === locale) return;

    startTransition(async () => {
      await setLocaleAction(next);
      // The server components above this one hold the old dictionary until the
      // tree is re-fetched.
      router.refresh();
    });
  }

  return (
    <div className={cn("relative", className)} ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={d.common.changeLanguage}
        title={d.common.changeLanguage}
        disabled={pending}
        className="flex items-center gap-1.5 rounded-md p-2 text-ink-muted hover:bg-surface-muted hover:text-ink disabled:opacity-60"
      >
        {pending ? (
          <SpinnerIcon className="size-5 animate-spin" />
        ) : (
          <GlobeIcon className="size-5" />
        )}
        <span className="hidden text-[12.5px] font-medium sm:block">
          {LOCALE_META[locale].label}
        </span>
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-[calc(100%+0.4rem)] z-40 w-44 overflow-hidden rounded-xl border border-line bg-surface p-1 shadow-pop"
        >
          {LOCALES.map((item) => (
            <button
              key={item}
              type="button"
              role="menuitemradio"
              aria-checked={item === locale}
              lang={LOCALE_META[item].htmlLang}
              onClick={() => choose(item)}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] hover:bg-surface-muted",
                item === locale ? "text-ink" : "text-ink-muted hover:text-ink",
              )}
            >
              <span className="min-w-0 flex-1 truncate">
                {LOCALE_META[item].label}
              </span>
              {item === locale ? (
                <CheckIcon className="size-4 shrink-0 text-brand" />
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
