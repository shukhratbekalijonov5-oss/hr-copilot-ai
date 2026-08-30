package ai.hrcopilot.notification.config;

import ai.hrcopilot.notification.email.EmailSender;
import ai.hrcopilot.notification.email.LogEmailSender;
import ai.hrcopilot.notification.email.ResendEmailSender;
import ai.hrcopilot.notification.email.SmtpEmailSender;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.Environment;
import org.springframework.mail.javamail.JavaMailSender;

/**
 * Exactly one email provider is active per boot.
 *
 * RESEND is production. SMTP is the local/relay path (Mailpit in dev). LOG
 * is a local convenience only — a production boot with EMAIL_PROVIDER=LOG
 * is refused outright, so a real deployment cannot silently swallow the
 * product's three emails.
 *
 * RESEND fails FAST on a missing credential: booting a production pod with
 * an unset RESEND_API_KEY would otherwise queue real welcome and payment
 * emails and reject every one of them at the provider. Refusing to start is
 * the loud, correct failure. The key's VALUE is never logged, compared
 * against a literal, or echoed in the message below — only its presence.
 */
@Configuration
public class EmailProviderConfiguration {

    private static final Logger log = LoggerFactory.getLogger(EmailProviderConfiguration.class);

    @Bean
    public EmailSender emailSender(
            NotificationServiceProperties properties,
            ObjectProvider<JavaMailSender> mail,
            Environment environment) {
        boolean production = environment.matchesProfiles("prod", "production");

        switch (properties.emailProvider()) {
            case RESEND -> {
                String key = properties.resendApiKey();
                if (key == null || key.isBlank()) {
                    throw new IllegalStateException(
                            "EMAIL_PROVIDER=RESEND requires RESEND_API_KEY to be set");
                }
                log.info("Email provider: RESEND (from={})", properties.fromHeader());
                return new ResendEmailSender(properties);
            }
            case LOG -> {
                if (production) {
                    throw new IllegalStateException(
                            "EMAIL_PROVIDER=LOG is not allowed in production");
                }
                return new LogEmailSender();
            }
            default -> {
                JavaMailSender javaMail = mail.getIfAvailable();
                if (javaMail == null) {
                    throw new IllegalStateException(
                            "EMAIL_PROVIDER=SMTP requires spring.mail configuration");
                }
                log.info("Email provider: SMTP");
                return new SmtpEmailSender(javaMail, properties);
            }
        }
    }
}
