package ai.hrcopilot.notification.email;

import ai.hrcopilot.notification.config.NotificationServiceProperties;
import jakarta.mail.internet.InternetAddress;
import jakarta.mail.internet.MimeMessage;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.MimeMessageHelper;

/**
 * Real SMTP delivery through Spring's JavaMailSender (host/port/credentials
 * arrive via standard spring.mail.* configuration; nothing is hardcoded).
 * Every message is multipart/alternative: plain text + HTML.
 */
public class SmtpEmailSender implements EmailSender {

    private final JavaMailSender mail;
    private final NotificationServiceProperties properties;

    public SmtpEmailSender(JavaMailSender mail, NotificationServiceProperties properties) {
        this.mail = mail;
        this.properties = properties;
    }

    @Override
    public String name() {
        return "SMTP";
    }

    @Override
    public void send(RenderedEmail email) {
        try {
            MimeMessage message = mail.createMimeMessage();
            MimeMessageHelper helper = new MimeMessageHelper(message, true, "UTF-8");
            helper.setFrom(new InternetAddress(
                    properties.fromEmail(), properties.fromName(), "UTF-8"));
            helper.setTo(email.toEmail());
            helper.setSubject(email.subject());
            helper.setText(email.text(), email.html());
            mail.send(message);
        } catch (Exception failure) {
            // Normalized so the worker's retry ladder sees one failure shape.
            throw new IllegalStateException(
                    "SMTP send failed: " + failure.getClass().getSimpleName(), failure);
        }
    }
}
