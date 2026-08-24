-- Payment Service foundation: billing accounts, subscriptions, payments,
-- provider webhook intake, audit trail, transactional outbox.
--
-- Plans and statuses are stored as VARCHAR, not Postgres enums, on purpose:
-- the service parses them defensively (unknown value -> entitlements fail
-- closed to FREE), and adding a tier later is an insert-nothing change here.

CREATE TABLE customer_billing_accounts (
    id                   UUID PRIMARY KEY,
    user_id              VARCHAR(64)  NOT NULL UNIQUE,
    candidate_account_id VARCHAR(64),
    created_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE subscriptions (
    id                   UUID PRIMARY KEY,
    billing_account_id   UUID         NOT NULL REFERENCES customer_billing_accounts (id),
    current_plan         VARCHAR(16)  NOT NULL,
    pending_plan         VARCHAR(16),
    effective_at         TIMESTAMPTZ,
    status               VARCHAR(32)  NOT NULL,
    current_period_start TIMESTAMPTZ,
    current_period_end   TIMESTAMPTZ,
    cancel_at_period_end BOOLEAN      NOT NULL DEFAULT FALSE,
    version              BIGINT       NOT NULL DEFAULT 0,
    created_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- One subscription per billing account.
CREATE UNIQUE INDEX subscriptions_billing_account_idx ON subscriptions (billing_account_id);

CREATE TABLE payments (
    id                   UUID PRIMARY KEY,
    billing_account_id   UUID         NOT NULL REFERENCES customer_billing_accounts (id),
    subscription_id      UUID         REFERENCES subscriptions (id),
    provider             VARCHAR(32)  NOT NULL,
    provider_payment_id  VARCHAR(128),
    provider_checkout_id VARCHAR(128),
    checkout_url         VARCHAR(512),
    idempotency_key      VARCHAR(128),
    plan                 VARCHAR(16)  NOT NULL,
    amount_cents         INTEGER      NOT NULL,
    currency             VARCHAR(8)   NOT NULL,
    status               VARCHAR(32)  NOT NULL,
    created_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Checkout idempotency: same account + same key = same order, enforced here.
CREATE UNIQUE INDEX payments_idempotency_idx
    ON payments (billing_account_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;
CREATE INDEX payments_account_idx ON payments (billing_account_id, created_at);

CREATE TABLE provider_webhook_events (
    id                UUID PRIMARY KEY,
    provider          VARCHAR(32)  NOT NULL,
    provider_event_id VARCHAR(160) NOT NULL,
    event_type        VARCHAR(64)  NOT NULL,
    payload           TEXT         NOT NULL,
    received_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    processed_at      TIMESTAMPTZ,
    processing_result VARCHAR(32),
    -- Webhook idempotency: one provider event is one row, ever.
    CONSTRAINT provider_webhook_events_unique UNIQUE (provider, provider_event_id)
);

CREATE TABLE billing_audit_log (
    id                 UUID PRIMARY KEY,
    billing_account_id UUID,
    user_id            VARCHAR(64) NOT NULL,
    action             VARCHAR(64) NOT NULL,
    detail             TEXT        NOT NULL,
    actor              VARCHAR(64) NOT NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX billing_audit_user_idx ON billing_audit_log (user_id, created_at);

CREATE TABLE outbox_events (
    id             UUID PRIMARY KEY,
    aggregate_type VARCHAR(32)  NOT NULL,
    aggregate_id   VARCHAR(64)  NOT NULL,
    event_type     VARCHAR(64)  NOT NULL,
    event_version  INTEGER      NOT NULL,
    topic          VARCHAR(128) NOT NULL,
    payload        TEXT         NOT NULL,
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    published_at   TIMESTAMPTZ,
    attempt_count  INTEGER      NOT NULL DEFAULT 0,
    last_error     TEXT
);
-- The publisher's work queue: pending rows, oldest first.
CREATE INDEX outbox_pending_idx ON outbox_events (created_at) WHERE published_at IS NULL;
