"use client";

import { useI18n } from "@/lib/i18n/context";
import type { AiInsight } from "@/lib/types";

/**
 * A titled list of generated points — strengths, gaps, or whatever a later
 * feature needs to enumerate.
 *
 * ## It renders nothing when there is nothing
 *
 * An empty list returns null rather than an empty box under a heading. A
 * "Potential gaps" panel with no gaps in it does not read as "no gaps found";
 * it reads as something that failed to load, and a reader who believes the
 * product is broken stops trusting the parts that work. `gaps: []` is a
 * legitimate answer — a strong match with nothing to flag — and the honest way
 * to show it is to show nothing.
 *
 * ## Plain text, structurally
 *
 * Both fields render as text nodes. There is no markdown pass and no
 * `dangerouslySetInnerHTML` anywhere in this feature: a model that emits
 * `<img onerror=…>` in a title is emitting those characters, and this renders
 * them as characters. That is a property of the code, not of the prompt — the
 * prompt is not a security boundary and must never be treated as one.
 *
 * ## Semantics over glyphs
 *
 * A real `<ul>`/`<li>`, so a screen reader announces "list, 3 items" and can
 * step through them. The ✓ and △ are `aria-hidden` decoration on top of a
 * heading that already says which list this is — tone is never the only thing
 * carrying the difference between a strength and a gap.
 */
export function AiInsightList({
  title,
  items,
  tone,
  headingLevel = 4,
}: {
  title: string;
  items: AiInsight[];
  tone: "positive" | "caution";
  headingLevel?: 3 | 4 | 5;
}) {
  const { d } = useI18n();
  if (items.length === 0) return null;

  const Heading = `h${headingLevel}` as "h3" | "h4" | "h5";
  const positive = tone === "positive";

  return (
    <section className="flex flex-col gap-2">
      <Heading className="text-[12.5px] font-semibold uppercase tracking-wide text-ink-subtle">
        {title}
      </Heading>
      <ul className="flex flex-col gap-2.5">
        {items.map((item, index) => (
          <li
            // Titles are model output and can repeat; the index is what makes
            // two identically-titled points two points rather than one.
            key={`${item.title}-${index}`}
            className="flex items-start gap-2"
          >
            <span
              aria-hidden="true"
              className={
                positive
                  ? "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-positive-soft text-[10px] font-bold text-positive"
                  : "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-warning-soft text-[10px] font-bold text-warning"
              }
            >
              {positive ? "✓" : "△"}
            </span>
            <div className="min-w-0">
              {/*
                `break-words` on both: Korean and Russian titles run long, and
                a German-length compound in a 320px drawer must wrap rather
                than widen the panel and force the whole page sideways.
              */}
              <p className="break-words text-[13px] font-medium leading-snug text-ink">
                {item.title}
                {/* The tone, in words, for anyone not seeing the glyph. */}
                <span className="sr-only">
                  {" "}
                  ({positive ? d.premiumAi.strengthLabel : d.premiumAi.gapLabel})
                </span>
              </p>
              {item.explanation ? (
                <p className="mt-0.5 break-words text-[12.5px] leading-relaxed text-ink-muted">
                  {item.explanation}
                </p>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
