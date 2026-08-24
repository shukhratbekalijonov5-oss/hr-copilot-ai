package ai.hrcopilot.payment.provider.toss;

/** Stable provider exception. Message is safe; raw Toss bodies are not kept. */
public class TossProviderException extends RuntimeException {
    private final Kind kind;

    public TossProviderException(Kind kind, String message) {
        super(message);
        this.kind = kind;
    }

    public Kind kind() {
        return kind;
    }

    public enum Kind {
        REJECTED,
        UNAVAILABLE,
        MALFORMED
    }
}
