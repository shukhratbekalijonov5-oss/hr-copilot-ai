"use client";

import { useI18n } from "@/lib/i18n/context";
import type { AiInterviewQuestion } from "@/lib/types";

/**
 * Questions a reader might be asked, each with its own two notes.
 *
 * ## The structure is the readability
 *
 * A question, why it might be asked, and how to prepare are three different
 * kinds of statement, and running them together produces the wall of text this
 * feature exists to avoid. So the question is the heading of its own item and
 * the two notes are a description list under it — which is also what lets a
 * screen-reader user move question by question instead of hearing one
 * continuous paragraph.
 *
 * `<ol>` rather than `<ul>`: the backend returns these in a considered order,
 * and "Question 3" is how a reader refers back to one.
 *
 * ## Nothing here is invented
 *
 * No sample answers, no score, no claim about the reader's own experience.
 * Every string rendered came from the backend, and a note the model left empty
 * renders as nothing rather than as a filled-in guess.
 */
export function AiQuestionList({
  title,
  questions,
  headingLevel = 4,
}: {
  title: string;
  questions: AiInterviewQuestion[];
  headingLevel?: 3 | 4 | 5;
}) {
  const { d, f } = useI18n();
  if (questions.length === 0) return null;

  const Heading = `h${headingLevel}` as "h3" | "h4" | "h5";

  return (
    <section className="flex flex-col gap-2">
      <Heading className="text-[12.5px] font-semibold uppercase tracking-wide text-ink-subtle">
        {title}
      </Heading>

      <ol className="flex flex-col gap-3">
        {questions.map((item, index) => (
          <li
            key={`${item.question}-${index}`}
            className="rounded-lg border border-line bg-surface px-3 py-2.5"
          >
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">
              {f(d.premiumAi.questionNumber, { number: String(index + 1) })}
            </p>
            {/*
              `break-words` and no fixed width: a Korean or Russian question
              runs long, and a card that grows sideways takes the whole drawer
              with it on a 320px screen.
            */}
            <p className="mt-0.5 break-words text-[13px] font-medium leading-snug text-ink">
              {item.question}
            </p>

            {item.whyAsked || item.preparation ? (
              <dl className="mt-2 flex flex-col gap-1.5">
                {item.whyAsked ? (
                  <div>
                    <dt className="text-[11.5px] font-medium text-ink-muted">
                      {d.premiumAi.whyAsked}
                    </dt>
                    <dd className="mt-0.5 break-words text-[12.5px] leading-relaxed text-ink-muted">
                      {item.whyAsked}
                    </dd>
                  </div>
                ) : null}
                {item.preparation ? (
                  <div>
                    <dt className="text-[11.5px] font-medium text-ink-muted">
                      {d.premiumAi.howToPrepare}
                    </dt>
                    <dd className="mt-0.5 break-words text-[12.5px] leading-relaxed text-ink-muted">
                      {item.preparation}
                    </dd>
                  </div>
                ) : null}
              </dl>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
