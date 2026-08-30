package ai.hrcopilot.notification.email;

/**
 * The delivery seam. Exactly one implementation is active per boot:
 * RESEND (production HTTPS API), SMTP (local Mailpit / any relay) or LOG
 * (local fallback — refused in production by EmailProviderConfiguration).
 * Implementations receive fully-rendered, already-escaped content and a
 * validated address; they add no content of their own and never log bodies
 * or addresses at INFO.
 *
 * Failure has exactly two shapes, and the distinction is the whole retry
 * policy: a plain RuntimeException is RETRYABLE (the worker steps onto its
 * backoff ladder), while {@link PermanentEmailException} is terminal (a
 * rejected address, a malformed request, a revoked credential — no number
 * of retries fixes any of them).
 */
public interface EmailSender {

    /** Provider name for logs/metrics ("RESEND" / "SMTP" / "LOG"). */
    String name();

    /**
     * Send one email.
     *
     * @return the provider's receipt; its message id may be null for
     *         providers that do not issue one (SMTP, LOG).
     * @throws PermanentEmailException when no retry could ever succeed
     */
    Receipt send(RenderedEmail email);

    /**
     * @param deliveryId the email_deliveries row id — carried so a provider
     *                   that supports request idempotency can key on it, and
     *                   a retry after a timeout cannot double-send.
     */
    record RenderedEmail(
            String deliveryId, String toEmail, String subject, String html, String text) {
    }

    /** @param providerMessageId provider-side id, or null if none is issued */
    record Receipt(String providerMessageId) {

        public static Receipt none() {
            return new Receipt(null);
        }
    }
}
