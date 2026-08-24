package ai.hrcopilot.notification.email;

/**
 * The delivery seam. Exactly one implementation is active per boot:
 * SMTP (real sending) or LOG (local fallback — refused in production by
 * EmailProviderConfiguration). Implementations receive fully-rendered,
 * already-escaped content and a validated address; they add no content of
 * their own and never log bodies or addresses at INFO.
 */
public interface EmailSender {

    /** Provider name for logs/metrics ("SMTP" / "LOG"). */
    String name();

    /** Send one email. Throwing means a retryable delivery failure. */
    void send(RenderedEmail email);

    record RenderedEmail(String toEmail, String subject, String html, String text) {
    }
}
