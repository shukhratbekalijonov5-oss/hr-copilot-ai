"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { SparkIcon } from "@/components/ui/icons";

interface VacancySearchBoxProps {
  vacancyId: string;
  suggestions: string[];
}

/** Scoped entry point into the full AI search page. */
export function VacancySearchBox({
  vacancyId,
  suggestions,
}: VacancySearchBoxProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");

  function run(value: string) {
    const trimmed = value.trim();
    if (!trimmed) return;
    router.push(
      `/search?vacancy=${encodeURIComponent(vacancyId)}&q=${encodeURIComponent(trimmed)}`,
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          run(query);
        }}
        className="flex flex-col gap-2 sm:flex-row"
      >
        <textarea
          rows={2}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              run(query);
            }
          }}
          aria-label="Search this vacancy's candidates"
          placeholder="Ask in plain language — e.g. who has run Kubernetes in production?"
          className="min-h-16 flex-1 resize-none rounded-lg border border-line bg-surface px-3 py-2.5 text-sm leading-relaxed text-ink placeholder:text-ink-subtle"
        />
        <Button type="submit" icon={<SparkIcon className="size-4" />} className="sm:self-start">
          Search
        </Button>
      </form>

      <div className="flex flex-wrap gap-1.5">
        {suggestions.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            onClick={() => run(suggestion)}
            className="rounded-md border border-line bg-surface-muted px-2 py-1 text-[12px] text-ink-muted transition-colors hover:border-line-strong hover:text-ink"
          >
            {suggestion}
          </button>
        ))}
      </div>

      <p className="text-[12px] leading-relaxed text-ink-subtle">
        Results show the passage each match came from, with its document and
        page. No candidate is scored or ranked by the model.
      </p>
    </div>
  );
}
