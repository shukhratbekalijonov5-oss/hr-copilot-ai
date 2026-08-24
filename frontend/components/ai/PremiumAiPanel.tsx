"use client";

import type { ReactNode } from "react";
import { SparkIcon } from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/context";

/**
 * The frame every on-demand MAX AI feature is presented in.
 *
 * "Why this match" is the first of four planned — cover letter, interview prep
 * and the advanced match breakdown will sit in the same frame. What it owns is
 * deliberately small: a heading at a caller-chosen level, the mark that says
 * this text was generated, and a slot. It owns no state, no request and no
 * knowledge of what is inside it.
 *
 * ## Why the disclaimer is structural rather than optional
 *
 * Generated prose about someone's own job prospects reads as authoritative —
 * it is fluent, specific, and sitting inside a product that also shows them
 * facts. The mark is part of the frame so a future feature cannot ship without
 * it by forgetting a prop, and it sits at the TOP, before the text, because a
 * caveat underneath a paragraph is read after the reader has already believed
 * it.
 *
 * ## The heading level is the caller's
 *
 * This renders inside a drawer whose title is an `<h2>`, so its heading is an
 * `<h3>`. Hard-coding a level here would produce a document outline that skips
 * or repeats levels depending on where the panel happened to be dropped, which
 * is precisely what makes heading navigation useless.
 */
export function PremiumAiPanel({
  title,
  headingLevel = 3,
  headingId,
  action,
  children,
}: {
  title: string;
  headingLevel?: 2 | 3 | 4;
  /** Lets a caller point `aria-labelledby` at this panel's own heading. */
  headingId?: string;
  /** The generate/retry control, rendered beside the heading. */
  action?: ReactNode;
  children?: ReactNode;
}) {
  const { d } = useI18n();
  const Heading = `h${headingLevel}` as "h2" | "h3" | "h4";

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-3 rounded-xl border border-line bg-surface-muted/60 p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-brand-soft text-brand-ink">
            <SparkIcon className="size-3.5" aria-hidden="true" />
          </span>
          <Heading
            id={headingId}
            className="min-w-0 text-[14px] font-semibold tracking-tight text-ink"
          >
            {title}
          </Heading>
        </div>
        {/* `shrink-0` so a long localized heading pushes the control to the
            next line rather than squeezing it into an unreadable sliver. */}
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>

      <p className="text-[11.5px] leading-relaxed text-ink-subtle">
        {d.premiumAi.disclaimer}
      </p>

      {children}
    </section>
  );
}
