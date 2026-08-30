-- Provider receipt on every email delivery.
--
-- Until now a SENT row proved only that the sender returned without
-- throwing. With a real external provider (Resend) that is no longer enough
-- to answer "what happened to this person's welcome email?": the provider's
-- own message id is the join key into its dashboard and logs.
--
-- Both columns are NULLABLE on purpose: rows sent before this migration
-- have no receipt, and SMTP issues no durable id at all. Absent means
-- "no id exists", never "not sent" — sent_at remains the authority on that.

ALTER TABLE email_deliveries
    ADD COLUMN provider            VARCHAR(32),
    ADD COLUMN provider_message_id VARCHAR(200);

-- Operational lookup: provider id → the delivery it belongs to.
CREATE INDEX email_deliveries_provider_message_idx
    ON email_deliveries (provider_message_id)
    WHERE provider_message_id IS NOT NULL;
