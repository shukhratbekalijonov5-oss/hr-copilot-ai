"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { CheckIcon } from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/context";
import {
  EMPTY_CARD_FORM,
  formatCardNumber,
  formatCvc,
  formatExpiry,
  validateCardForm,
  type CardErrors,
  type CardFormValues,
} from "@/lib/billing/card-form";
import {
  capabilitiesForPlan,
  KRW_CHECKOUT_CHARGE,
  priceFor,
  type CheckoutPlan,
} from "@/lib/entitlements/plan";

/**
 * The branded checkout dialog.
 *
 * ## The card fields are decoration, and the code has to make that true
 *
 * Everything typed into this form lives in ONE piece of component state that
 * is wiped on close and on success. It is never an argument to a server
 * action, never serialised, never stored. `onPay` deliberately takes no
 * parameters at all — there is no channel through which a card value could
 * reach the server even by mistake, and that is checked by a test rather than
 * left to review.
 *
 * ## Two different CTAs, decided by the environment, not by the form
 *
 * Where the dev plan switch exists (local/dev), a valid form completes the
 * demo purchase through that existing switch and the caller refetches the
 * authoritative plan. Where it does not (production), this dialog does not
 * pretend to charge anything: it hands off to the real Toss redirect, which
 * remains the only production payment path. The demo cannot become a
 * production bypass because the branch is on the same flag the switch is.
 */
export function DemoCheckoutModal({
  plan,
  demoPaymentEnabled,
  pending,
  error,
  succeeded,
  onClose,
  onPay,
  onRealCheckout,
}: {
  plan: CheckoutPlan;
  /** True only where the existing dev plan switch is itself available. */
  demoPaymentEnabled: boolean;
  pending: boolean;
  error: string | null;
  succeeded: boolean;
  onClose: () => void;
  onPay: () => void;
  onRealCheckout: () => void;
}) {
  const { d, f } = useI18n();
  const copy = d.plans.demoCheckout;
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const dialogRef = useRef<HTMLDivElement>(null);

  const amount = String(priceFor(plan).monthlyUsd);
  const planName = d.plans.names[plan];

  function close() {
    if (pending) return;
    onClose();
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !pending) close();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  return (
    <div
      className="animate-fade-in fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/45 p-4 backdrop-blur-[2px] sm:items-center sm:p-6"
      role="presentation"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="animate-pop-in w-full max-w-3xl overflow-hidden rounded-[18px] border border-line bg-surface shadow-pop focus-visible:outline-none"
      >
        <div className="grid md:grid-cols-2">
          {/* LEFT — brand, plan, price, illustration. */}
          <div className="flex flex-col gap-5 bg-brand-soft/50 p-5 sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[13.5px] font-semibold tracking-tight text-ink">
                {copy.brand}
              </p>
              <span className="rounded-full border border-line bg-surface px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-ink-muted">
                {copy.demoBadge}
              </span>
            </div>

            <div>
              <h2
                id={titleId}
                className="text-[19px] font-semibold tracking-tight text-ink"
              >
                {copy.title}
              </h2>
              <p className="mt-1 text-[12px] font-medium uppercase tracking-wide text-ink-subtle">
                {copy.selectedPlan}
              </p>
              <p className="mt-1 flex items-baseline gap-2">
                <span className="text-[22px] font-semibold leading-none tracking-tight text-ink">
                  {planName}
                </span>
                <span className="text-[13px] text-ink-muted">
                  {f(d.plans.priceMonthly, { amount })}
                </span>
              </p>
            </div>

            <CardArt planName={planName} />

            <ul className="flex flex-col gap-1.5" aria-label={copy.orderSummary}>
              {capabilitiesForPlan(plan).map((capability) => (
                <li
                  key={capability}
                  className="flex items-start gap-2 text-[13px] leading-relaxed text-ink"
                >
                  <CheckIcon className="mt-0.5 size-4 shrink-0 text-positive" />
                  {d.plans.capabilityNames[capability]}
                </li>
              ))}
            </ul>

            <dl className="mt-auto space-y-1.5 border-t border-line pt-3 text-[13px]">
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-ink-muted">{copy.subtotal}</dt>
                <dd className="tabular-nums text-ink">${amount}.00</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="font-medium text-ink">{copy.totalDueToday}</dt>
                <dd className="text-[15px] font-semibold tabular-nums text-ink">
                  ${amount}.00
                </dd>
              </div>
              <p className="text-[11.5px] text-ink-subtle">{copy.billedMonthly}</p>
            </dl>
          </div>

          {/* RIGHT — payment details, or the outcome. */}
          <div className="relative flex flex-col p-5 sm:p-6">
            <button
              type="button"
              onClick={close}
              disabled={pending}
              aria-label={copy.close}
              className="absolute right-3 top-3 grid size-8 place-items-center rounded-md text-ink-muted hover:bg-surface-muted hover:text-ink disabled:opacity-50"
            >
              <span aria-hidden="true" className="text-[17px] leading-none">
                ×
              </span>
            </button>

            {succeeded ? (
              <div className="flex flex-1 flex-col items-start justify-center gap-3 py-6">
                <span className="grid size-10 place-items-center rounded-full bg-positive-soft text-positive">
                  <CheckIcon className="size-5" />
                </span>
                <h3 className="text-[16px] font-semibold tracking-tight text-ink">
                  {copy.successTitle}
                </h3>
                <p role="status" className="text-[13px] leading-relaxed text-ink-muted">
                  {f(copy.successBody, { plan: planName })}
                </p>
                <Button type="button" size="sm" onClick={close} autoFocus>
                  {copy.done}
                </Button>
              </div>
            ) : demoPaymentEnabled ? (
              <PaymentForm
                payLabel={f(copy.pay, { amount })}
                pending={pending}
                error={error}
                onCancel={close}
                onPay={onPay}
              />
            ) : (
              /* Production: no demo charge exists, so none is offered. */
              <div className="flex flex-1 flex-col gap-3">
                <h3 className="pr-8 text-[15.5px] font-semibold tracking-tight text-ink">
                  {copy.paymentDetails}
                </h3>
                <p className="text-[13px] leading-relaxed text-ink-muted">
                  {copy.realCheckoutNote}
                </p>
                <p className="text-[12.5px] leading-relaxed text-ink-subtle">
                  {f(d.plans.checkout.chargedAsKrw, {
                    usd: amount,
                    krw: KRW_CHECKOUT_CHARGE[plan],
                  })}
                </p>
                {error ? (
                  <p
                    role="alert"
                    className="rounded-lg border border-critical/30 bg-critical/10 px-3 py-2 text-[12.5px] leading-relaxed text-critical"
                  >
                    {error}
                  </p>
                ) : null}
                <div className="mt-auto flex flex-wrap items-center justify-end gap-2 pt-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={pending}
                    onClick={close}
                  >
                    {d.common.cancel}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    loading={pending}
                    onClick={onRealCheckout}
                  >
                    {copy.continueToProvider}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Purely decorative card artwork — no value shown comes from the form. */
function CardArt({ planName }: { planName: string }) {
  return (
    <div
      aria-hidden="true"
      className="relative aspect-[16/10] w-full overflow-hidden rounded-xl bg-gradient-to-br from-ink via-ink/90 to-brand p-4 shadow-card"
    >
      <div className="absolute -right-8 -top-10 size-28 rounded-full bg-white/10" />
      <div className="absolute -bottom-12 -left-6 size-32 rounded-full bg-white/5" />
      <div className="relative flex h-full flex-col justify-between text-white">
        <div className="flex items-start justify-between">
          <span className="text-[12px] font-semibold tracking-wide">
            {planName}
          </span>
          <span className="flex items-center">
            <span className="size-5 rounded-full bg-white/70" />
            <span className="-ml-2 size-5 rounded-full bg-white/40" />
          </span>
        </div>
        <div className="h-6 w-11 rounded bg-gradient-to-br from-amber-200 to-amber-400/80" />
        <div>
          <p className="font-mono text-[13px] tracking-[0.18em] text-white/85">
            •••• •••• •••• ••••
          </p>
          <p className="mt-1.5 text-[10px] uppercase tracking-[0.2em] text-white/55">
            HR Copilot AI
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * The card fields, deliberately in their own component.
 *
 * Every value lives in this component's state and nowhere else. Success
 * swaps this subtree for the confirmation panel and closing unmounts the
 * whole dialog, so in both cases React destroys the values — there is no
 * longer-lived store to forget to clear, and nothing to serialise.
 *
 * `onPay` takes no arguments: the card physically cannot reach the server.
 */
function PaymentForm({
  payLabel,
  pending,
  error,
  onCancel,
  onPay,
}: {
  payLabel: string;
  pending: boolean;
  error: string | null;
  onCancel: () => void;
  onPay: () => void;
}) {
  const { d } = useI18n();
  const copy = d.plans.demoCheckout;

  const [card, setCard] = useState<CardFormValues>(EMPTY_CARD_FORM);
  const [saveCard, setSaveCard] = useState(false);
  const [errors, setErrors] = useState<CardErrors>({});
  const [formError, setFormError] = useState(false);

  function set(key: keyof CardFormValues, value: string) {
    setCard((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
    setFormError(false);
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;

    const found = validateCardForm(card);
    if (Object.keys(found).length > 0) {
      setErrors(found);
      setFormError(true);
      return;
    }

    setErrors({});
    setFormError(false);
    onPay();
  }

  function messageFor(field: keyof CardFormValues): string | null {
    const reason = errors[field];
    if (!reason) return null;
    if (reason === "required") return copy.errors.required;
    if (field === "number") return copy.errors.invalidCardNumber;
    if (field === "expiry") return copy.errors.invalidExpiry;
    return copy.errors.invalidCvc;
  }

  return (
    <form onSubmit={submit} className="flex flex-1 flex-col gap-3">
      <h3 className="pr-8 text-[15.5px] font-semibold tracking-tight text-ink">
        {copy.paymentDetails}
      </h3>

      <Input
        label={copy.cardholder}
        value={card.cardholder}
        autoComplete="off"
        placeholder={copy.cardholderPlaceholder}
        disabled={pending}
        error={messageFor("cardholder")}
        onChange={(event) => set("cardholder", event.target.value)}
      />
      <Input
        label={copy.cardNumber}
        value={card.number}
        inputMode="numeric"
        autoComplete="off"
        placeholder="4242 4242 4242 4242"
        disabled={pending}
        error={messageFor("number")}
        onChange={(event) => set("number", formatCardNumber(event.target.value))}
      />
      <div className="grid grid-cols-2 gap-3">
        <Input
          label={copy.expiry}
          value={card.expiry}
          inputMode="numeric"
          autoComplete="off"
          placeholder="04/29"
          disabled={pending}
          error={messageFor("expiry")}
          onChange={(event) => set("expiry", formatExpiry(event.target.value))}
        />
        <Input
          label={copy.cvc}
          value={card.cvc}
          inputMode="numeric"
          autoComplete="off"
          placeholder="123"
          disabled={pending}
          error={messageFor("cvc")}
          onChange={(event) => set("cvc", formatCvc(event.target.value))}
        />
      </div>

      <label className="flex items-center gap-2 text-[13px] text-ink-muted">
        <input
          type="checkbox"
          checked={saveCard}
          disabled={pending}
          onChange={(event) => setSaveCard(event.target.checked)}
          className="size-4 rounded border-line text-brand"
        />
        {copy.saveCard}
      </label>

      {formError ? (
        <p role="alert" className="text-[12.5px] text-critical">
          {copy.errors.formInvalid}
        </p>
      ) : null}
      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-critical/30 bg-critical/10 px-3 py-2 text-[12.5px] leading-relaxed text-critical"
        >
          {error}
        </p>
      ) : null}

      <p className="text-[11.5px] leading-relaxed text-ink-subtle">
        {copy.demoNote}
      </p>

      <div className="mt-auto flex flex-wrap items-center justify-end gap-2 pt-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={pending}
          onClick={onCancel}
        >
          {d.common.cancel}
        </Button>
        <Button type="submit" size="sm" loading={pending}>
          {payLabel}
        </Button>
      </div>
    </form>
  );
}
