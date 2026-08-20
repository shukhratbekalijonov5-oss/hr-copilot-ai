"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { SearchIcon } from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/context";
import { MIN_EVIDENCE_QUERY_LENGTH } from "@/lib/search/constants";

interface SearchFormProps {
  /** The query currently in the URL; empty when no search is active. */
  query: string;
}

/**
 * The search box.
 *
 * The query lives in the URL (`/search?q=…`), not in component state: the page
 * component starts retrieval and generation from that parameter and streams
 * each in as it completes, and a search can be shared or restored by the back
 * button. Submitting the same query again re-runs it via a refresh, since the
 * URL would not change.
 *
 * The page remounts this form per query (key={query}), so the textarea shows
 * the query a restored URL was searched with.
 */
export function SearchForm({ query }: SearchFormProps) {
  const { d } = useI18n();
  const router = useRouter();

  const [value, setValue] = useState(query);
  const [tooShort, setTooShort] = useState(false);
  const [pending, startTransition] = useTransition();

  function run(raw: string) {
    if (pending) return;
    const trimmed = raw.trim();
    if (trimmed.length < MIN_EVIDENCE_QUERY_LENGTH) {
      setTooShort(true);
      return;
    }

    setTooShort(false);
    startTransition(() => {
      if (trimmed === query) router.refresh();
      else router.push(`/search?q=${encodeURIComponent(trimmed)}`);
    });
  }

  return (
    <Card>
      <CardBody className="flex flex-col gap-3">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            run(value);
          }}
          className="flex flex-col gap-3"
        >
          <label htmlFor="evidence-search" className="sr-only">
            {d.search.label}
          </label>
          <textarea
            id="evidence-search"
            rows={3}
            value={value}
            disabled={pending}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                run(value);
              }
            }}
            placeholder={d.search.placeholder}
            className="min-h-24 w-full resize-none rounded-lg border border-line bg-surface px-3.5 py-3 text-[15px] leading-relaxed text-ink placeholder:text-ink-subtle disabled:opacity-60"
          />

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <p className="text-[12px] text-ink-subtle">{d.search.hint}</p>
            <Button
              type="submit"
              loading={pending}
              icon={<SearchIcon className="size-4" />}
              className="sm:ml-auto"
            >
              {d.search.submit}
            </Button>
          </div>

          {tooShort ? (
            <p role="alert" className="text-[12.5px] text-critical">
              {d.search.minLength}
            </p>
          ) : null}
        </form>

        {!query ? (
          <div className="flex flex-wrap gap-1.5 border-t border-line pt-3">
            {d.search.examples.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => {
                  setValue(example);
                  run(example);
                }}
                className="rounded-md border border-line bg-surface-muted px-2 py-1 text-[12px] text-ink-muted transition-colors hover:border-line-strong hover:text-ink"
              >
                {example}
              </button>
            ))}
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}
