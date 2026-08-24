"use client";

/**
 * The one-paragraph summary a generation opens with.
 *
 * Its own component because every planned MAX feature has one, and because the
 * two rules it enforces are easy to lose in a larger file: the text is a text
 * node — never markup, never markdown — and it wraps rather than widening its
 * container, which is what keeps a long Russian or Korean paragraph from
 * pushing a 320px drawer sideways.
 */
export function AiSummary({ text }: { text: string }) {
  return (
    <p className="break-words text-[13px] leading-relaxed text-ink">{text}</p>
  );
}
