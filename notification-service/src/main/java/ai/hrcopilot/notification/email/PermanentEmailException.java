package ai.hrcopilot.notification.email;

/**
 * A delivery failure no retry can fix: the provider rejected the request
 * itself (invalid recipient, malformed payload, unverified sending domain,
 * revoked API key) rather than failing to carry it.
 *
 * The worker marks these FAILED_PERMANENT immediately — they stay visible
 * in the row and in metrics, but never consume the backoff ladder. Anything
 * that could plausibly succeed later (429, 5xx, timeouts, connection
 * failures) must NOT use this type.
 *
 * Messages here are provider text and are treated as untrusted: the worker
 * strips CR/LF and clips before persisting, and no credential ever reaches
 * a message because the sender never puts one there.
 */
public class PermanentEmailException extends RuntimeException {

    public PermanentEmailException(String message) {
        super(message);
    }
}
