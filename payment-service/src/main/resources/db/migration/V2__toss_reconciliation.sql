-- Provider reconciliation for Toss confirmation and webhook refetch.
ALTER TABLE payments
    ADD COLUMN version BIGINT NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX payments_provider_checkout_idx
    ON payments (provider, provider_checkout_id)
    WHERE provider_checkout_id IS NOT NULL;

CREATE UNIQUE INDEX payments_provider_payment_idx
    ON payments (provider, provider_payment_id)
    WHERE provider_payment_id IS NOT NULL;
