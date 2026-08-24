package ai.hrcopilot.notification.config;

import ai.hrcopilot.notification.email.EmailSender;
import ai.hrcopilot.notification.email.LogEmailSender;
import ai.hrcopilot.notification.email.SmtpEmailSender;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.Environment;
import org.springframework.mail.javamail.JavaMailSender;

/**
 * Exactly one email provider is active. LOG is a local convenience only —
 * a production boot with EMAIL_PROVIDER=LOG is refused outright (both
 * common production profile spellings), so a real deployment cannot
 * silently swallow the product's three emails.
 */
@Configuration
public class EmailProviderConfiguration {

    @Bean
    public EmailSender emailSender(
            NotificationServiceProperties properties,
            JavaMailSender mail,
            Environment environment) {
        if (properties.emailProvider() == NotificationServiceProperties.Provider.LOG) {
            if (environment.matchesProfiles("prod", "production")) {
                throw new IllegalStateException(
                        "EMAIL_PROVIDER=LOG is not allowed in production");
            }
            return new LogEmailSender();
        }
        return new SmtpEmailSender(mail, properties);
    }
}
