package ai.hrcopilot.notification.email;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Local fallback: records that a send WOULD have happened — subject length
 * and nothing else; no address, no body. Refused in production by
 * EmailProviderConfiguration, and the live local proof uses real SMTP
 * against Mailpit, never this.
 */
public class LogEmailSender implements EmailSender {

    private static final Logger log = LoggerFactory.getLogger(LogEmailSender.class);

    @Override
    public String name() {
        return "LOG";
    }

    @Override
    public Receipt send(RenderedEmail email) {
        log.info("LOG email provider: would send ({} chars subject)", email.subject().length());
        return Receipt.none();
    }
}
