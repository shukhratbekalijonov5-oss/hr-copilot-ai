-- Notification Service foundation: the authoritative notification store,
-- email delivery state, and the created-echo outbox.
--
-- Types/statuses are VARCHAR + defensive parsing (unknown values degrade to
-- "no effect", never an exception) — same stance as the Payment Service.

CREATE TABLE notifications (
    id                 UUID PRIMARY KEY,
    -- The idempotency anchor: one logical event is one row, ever. Backend
    -- outbox ids, payment eventIds and scheduler-derived keys all land here.
    event_id           VARCHAR(200) NOT NULL UNIQUE,
    recipient_user_id  VARCHAR(64)  NOT NULL,
    organization_id    VARCHAR(64),
    audience           VARCHAR(16)  NOT NULL,
    type               VARCHAR(64)  NOT NULL,
    -- Minimal safe render context (ids + display snapshots + clipped
    -- preview), stored as the JSON the event carried. Never credentials,
    -- documents or raw user HTML.
    context_json       TEXT         NOT NULL,
    read_at            TIMESTAMPTZ,
    created_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX notifications_recipient_created_idx
    ON notifications (recipient_user_id, created_at DESC);
CREATE INDEX notifications_recipient_unread_idx
    ON notifications (recipient_user_id, read_at, created_at DESC);

CREATE TABLE email_deliveries (
    id                 UUID PRIMARY KEY,
    notification_id    UUID REFERENCES notifications (id),
    event_id           VARCHAR(200) NOT NULL,
    email_type         VARCHAR(64)  NOT NULL,
    recipient_user_id  VARCHAR(64)  NOT NULL,
    -- PENDING → PROCESSING → SENT | FAILED_RETRYABLE (→ retry) | FAILED_PERMANENT
    status             VARCHAR(32)  NOT NULL,
    attempt_count      INTEGER      NOT NULL DEFAULT 0,
    next_attempt_at    TIMESTAMPTZ,
    last_error         TEXT,
    sent_at            TIMESTAMPTZ,
    created_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
    -- Email idempotency: one logical event sends one email of one type.
    CONSTRAINT email_deliveries_event_unique UNIQUE (event_id, email_type)
);
CREATE INDEX email_deliveries_due_idx
    ON email_deliveries (status, next_attempt_at);

-- The created-echo outbox: every persisted notification is announced to the
-- backend's realtime bridge through Kafka, transactionally with the row.
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
    last_error     TEXT,
    next_attempt_at TIMESTAMPTZ
);
CREATE INDEX outbox_pending_idx ON outbox_events (created_at) WHERE published_at IS NULL;
