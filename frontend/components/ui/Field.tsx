"use client";

import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { useId } from "react";
import { cn } from "@/lib/utils";

const CONTROL =
  "w-full rounded-lg border bg-surface px-3 text-sm text-ink placeholder:text-ink-subtle transition-colors disabled:cursor-not-allowed disabled:opacity-60";

function controlClasses(invalid: boolean, className?: string) {
  return cn(
    CONTROL,
    invalid ? "border-critical" : "border-line hover:border-line-strong",
    className,
  );
}

interface FieldShellProps {
  id: string;
  label?: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  required?: boolean;
  children: ReactNode;
  className?: string;
}

export function FieldShell({
  id,
  label,
  hint,
  error,
  required,
  children,
  className,
}: FieldShellProps) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {label ? (
        <label
          htmlFor={id}
          className="text-[13px] font-medium text-ink flex items-center gap-1"
        >
          {label}
          {required ? (
            <span className="text-critical" aria-hidden="true">
              *
            </span>
          ) : null}
        </label>
      ) : null}
      {children}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-[12.5px] text-critical">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-[12.5px] text-ink-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  leading?: ReactNode;
  trailing?: ReactNode;
  wrapperClassName?: string;
}

export function Input({
  label,
  hint,
  error,
  leading,
  trailing,
  className,
  wrapperClassName,
  id,
  required,
  ...props
}: InputProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const invalid = Boolean(error);

  return (
    <FieldShell
      id={fieldId}
      label={label}
      hint={hint}
      error={error}
      required={required}
      className={wrapperClassName}
    >
      <div className="relative">
        {leading ? (
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle">
            {leading}
          </span>
        ) : null}
        <input
          id={fieldId}
          aria-invalid={invalid || undefined}
          aria-describedby={
            error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined
          }
          className={controlClasses(
            invalid,
            cn(
              "h-9.5",
              leading ? "pl-9.5" : undefined,
              trailing ? "pr-10" : undefined,
              className,
            ),
          )}
          {...props}
        />
        {trailing ? (
          <span className="absolute right-2 top-1/2 -translate-y-1/2">
            {trailing}
          </span>
        ) : null}
      </div>
    </FieldShell>
  );
}

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: ReactNode;
  hint?: ReactNode;
  error?: string | null;
}

export function Textarea({
  label,
  hint,
  error,
  className,
  id,
  required,
  ...props
}: TextareaProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const invalid = Boolean(error);

  return (
    <FieldShell
      id={fieldId}
      label={label}
      hint={hint}
      error={error}
      required={required}
    >
      <textarea
        id={fieldId}
        aria-invalid={invalid || undefined}
        aria-describedby={
          error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined
        }
        className={controlClasses(invalid, cn("py-2.5 leading-relaxed", className))}
        {...props}
      />
    </FieldShell>
  );
}

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  options: { value: string; label: string }[];
}

export function Select({
  label,
  hint,
  error,
  options,
  className,
  id,
  required,
  ...props
}: SelectProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;

  return (
    <FieldShell
      id={fieldId}
      label={label}
      hint={hint}
      error={error}
      required={required}
    >
      <select
        id={fieldId}
        className={controlClasses(
          Boolean(error),
          cn("h-9.5 appearance-none pr-8 bg-no-repeat", className),
        )}
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%238b93a4' stroke-width='2' stroke-linecap='round'%3E%3Cpath d='m6 9.5 6 6 6-6'/%3E%3C/svg%3E\")",
          backgroundPosition: "right 0.6rem center",
          backgroundSize: "1rem",
        }}
        {...props}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}

interface CheckboxProps extends InputHTMLAttributes<HTMLInputElement> {
  label: ReactNode;
  description?: ReactNode;
}

export function Checkbox({
  label,
  description,
  className,
  id,
  ...props
}: CheckboxProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;

  return (
    <div className={cn("flex items-start gap-2.5", className)}>
      <input
        id={fieldId}
        type="checkbox"
        className="mt-0.5 size-4 shrink-0 rounded border-line-strong accent-[var(--brand)]"
        {...props}
      />
      <label htmlFor={fieldId} className="text-[13px] leading-snug">
        <span className="font-medium text-ink">{label}</span>
        {description ? (
          <span className="mt-0.5 block text-ink-muted">{description}</span>
        ) : null}
      </label>
    </div>
  );
}
