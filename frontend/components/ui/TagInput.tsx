"use client";

import { useId, useState } from "react";
import { CloseIcon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

interface TagInputProps {
  label?: string;
  hint?: string;
  error?: string | null;
  placeholder?: string;
  value: string[];
  onChange: (value: string[]) => void;
  className?: string;
}

/** Comma- or Enter-separated chips. Duplicates are ignored. */
export function TagInput({
  label,
  hint,
  error,
  placeholder,
  value,
  onChange,
  className,
}: TagInputProps) {
  const inputId = useId();
  const [draft, setDraft] = useState("");

  function commit(raw: string) {
    const next = raw.trim().replace(/,$/, "").trim();
    if (!next) return;
    if (value.some((item) => item.toLowerCase() === next.toLowerCase())) {
      setDraft("");
      return;
    }
    onChange([...value, next]);
    setDraft("");
  }

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {label ? (
        <label htmlFor={inputId} className="text-[13px] font-medium text-ink">
          {label}
        </label>
      ) : null}

      <div
        className={cn(
          "flex flex-wrap items-center gap-1.5 rounded-lg border bg-surface p-1.5",
          error ? "border-critical" : "border-line",
        )}
      >
        {value.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 rounded-md bg-surface-muted px-1.5 py-0.5 text-[12.5px] text-ink"
          >
            {tag}
            <button
              type="button"
              aria-label={`Remove ${tag}`}
              onClick={() => onChange(value.filter((item) => item !== tag))}
              className="rounded text-ink-subtle hover:text-critical"
            >
              <CloseIcon className="size-3" />
            </button>
          </span>
        ))}
        <input
          id={inputId}
          value={draft}
          placeholder={value.length === 0 ? placeholder : ""}
          aria-describedby={error ? `${inputId}-error` : undefined}
          onChange={(event) => {
            const next = event.target.value;
            if (next.endsWith(",")) commit(next);
            else setDraft(next);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit(draft);
            } else if (event.key === "Backspace" && !draft && value.length > 0) {
              onChange(value.slice(0, -1));
            }
          }}
          onBlur={() => commit(draft)}
          className="min-w-32 flex-1 bg-transparent px-1.5 py-1 text-sm text-ink outline-none placeholder:text-ink-subtle"
        />
      </div>

      {error ? (
        <p id={`${inputId}-error`} role="alert" className="text-[12.5px] text-critical">
          {error}
        </p>
      ) : hint ? (
        <p className="text-[12.5px] text-ink-muted">{hint}</p>
      ) : null}
    </div>
  );
}
