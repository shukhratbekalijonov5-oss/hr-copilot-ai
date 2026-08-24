"use client";

/**
 * A generated document — a subject line and a body of prose.
 *
 * ## Paragraphs are split, never interpreted
 *
 * The body arrives as plain text with blank-line breaks. Splitting on those
 * and rendering a `<p>` each is the whole of the formatting: no markdown pass,
 * no HTML, no `dangerouslySetInnerHTML`. A letter containing `**Dear**` shows
 * those asterisks, which is correct — the model wrote characters, not markup,
 * and deciding otherwise is how generated output becomes executable.
 *
 * `whitespace-pre-line` on each paragraph preserves single newlines inside
 * one, so an address block or a sign-off keeps its shape.
 *
 * ## Selectable, because copying can fail
 *
 * The text is always rendered in full and never collapsed behind the copy
 * button. When the clipboard API is unavailable — which is ordinary, not
 * exotic — selecting it by hand has to remain possible.
 */
export function AiTextDocument({
  subject,
  subjectLabel,
  content,
}: {
  subject: string | null;
  /** e.g. "Subject" — a label, so the line is not mistaken for a heading. */
  subjectLabel: string;
  content: string;
}) {
  const paragraphs = content
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);

  return (
    <div className="flex flex-col gap-3">
      {subject ? (
        <div className="rounded-lg border border-line bg-surface px-3 py-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">
            {subjectLabel}
          </p>
          <p className="mt-0.5 break-words text-[13px] font-medium text-ink">
            {subject}
          </p>
        </div>
      ) : null}

      <div className="flex flex-col gap-2.5 rounded-lg border border-line bg-surface px-3 py-3">
        {paragraphs.map((paragraph, index) => (
          <p
            // Generated paragraphs can repeat verbatim; the index is what
            // keeps two identical lines two lines.
            key={index}
            className="break-words whitespace-pre-line text-[13px] leading-relaxed text-ink"
          >
            {paragraph}
          </p>
        ))}
      </div>
    </div>
  );
}
