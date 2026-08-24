-- Outbox retry hardening: a failing event steps aside with exponential
-- backoff instead of being retried on every publisher tick. NULL means
-- "eligible now" (all pre-existing rows stay immediately eligible).
ALTER TABLE outbox_events
    ADD COLUMN next_attempt_at TIMESTAMPTZ;
