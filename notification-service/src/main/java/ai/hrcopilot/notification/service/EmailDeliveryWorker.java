package ai.hrcopilot.notification.service;

import ai.hrcopilot.notification.config.NotificationServiceProperties;
import ai.hrcopilot.notification.domain.entity.EmailDelivery;
import ai.hrcopilot.notification.email.EmailSender;
import ai.hrcopilot.notification.email.EmailTemplates;
import ai.hrcopilot.notification.repository.EmailDeliveryRepository;
import ai.hrcopilot.notification.repository.NotificationRepository;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.PageRequest;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Sends the product's emails — the asynchronous half of email delivery.
 *
 * Each tick locks a bounded batch of DUE deliveries with SKIP LOCKED
 * (multi-replica safe), and for each one: resolves the recipient's CURRENT
 * identity from the backend (the address is never stored — a profile email
 * change between attempts redirects the retry automatically), renders the
 * localized template, and hands the sender one fully-escaped message.
 *
 * Failure is a ladder, not a loop: 30s → 2m → 10m → 30m → 2h, then
 * FAILED_PERMANENT — counted, visible, never silently dropped and never
 * hot-retried. A missing recipient (deleted account) is permanent
 * immediately; an unreadable backend or a down SMTP host is retryable.
 * In-app notifications are entirely unaffected by anything here.
 */
@Component
public class EmailDeliveryWorker {

    private static final Logger log = LoggerFactory.getLogger(EmailDeliveryWorker.class);
    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final DateTimeFormatter DATE =
            DateTimeFormatter.ofPattern("yyyy-MM-dd").withZone(ZoneOffset.UTC);

    private final EmailDeliveryRepository deliveries;
    private final NotificationRepository notifications;
    private final RecipientDirectory recipients;
    private final EmailSender sender;
    private final NotificationServiceProperties properties;
    private final TransactionTemplate transactions;
    private final Counter sent;
    private final Counter failed;
    private final Counter retried;
    private final Timer latency;

    public EmailDeliveryWorker(
            EmailDeliveryRepository deliveries,
            NotificationRepository notifications,
            RecipientDirectory recipients,
            EmailSender sender,
            NotificationServiceProperties properties,
            TransactionTemplate transactions,
            MeterRegistry meters) {
        this.deliveries = deliveries;
        this.notifications = notifications;
        this.recipients = recipients;
        this.sender = sender;
        this.properties = properties;
        this.transactions = transactions;
        this.sent = Counter.builder("notification_email_sent_total").register(meters);
        this.failed = Counter.builder("notification_email_failed_total").register(meters);
        this.retried = Counter.builder("notification_email_retry_total").register(meters);
        this.latency = Timer.builder("notification_delivery_latency")
                .description("Created → sent latency for product emails")
                .register(meters);
        Gauge.builder("notification_email_pending", deliveries, repository ->
                        repository.countByStatusIn(List.of("PENDING", "FAILED_RETRYABLE")))
                .description("Email deliveries awaiting a (re)try")
                .register(meters);
        Gauge.builder("notification_unread_total", notifications,
                        NotificationRepository::countByReadAtIsNull)
                .description("Unread in-app notifications, all users")
                .register(meters);
    }

    @Scheduled(fixedDelayString = "${notification.email-poll-ms:2000}")
    public void deliverDue() {
        transactions.executeWithoutResult(ignored -> {
            List<EmailDelivery> batch = deliveries.lockDueBatch(
                    Instant.now(), PageRequest.of(0, properties.emailBatchSize()));
            for (EmailDelivery delivery : batch) {
                attempt(delivery);
            }
            deliveries.saveAll(batch);
        });
    }

    private void attempt(EmailDelivery delivery) {
        if (delivery.getAttemptCount() > 0) {
            retried.increment();
        }
        if (!EmailTemplates.supports(delivery.getEmailType())) {
            // A delivery row for a type with no template is a policy bug,
            // not a transient condition — visible, never hot-retried.
            delivery.markPermanentlyFailed("no template family for " + delivery.getEmailType());
            failed.increment();
            return;
        }

        RecipientDirectory.Resolution resolution =
                recipients.resolve(delivery.getRecipientUserId());
        if (resolution.status() == RecipientDirectory.Status.MISSING) {
            delivery.markPermanentlyFailed("recipient no longer exists");
            failed.increment();
            return;
        }
        if (resolution.status() == RecipientDirectory.Status.UNAVAILABLE) {
            delivery.markFailed("recipient lookup unavailable");
            failed.increment();
            return;
        }

        RecipientDirectory.Recipient recipient = resolution.recipient();
        try {
            EmailTemplates.Rendered rendered = EmailTemplates.render(
                    delivery.getEmailType(),
                    recipient.locale(),
                    templateValues(delivery, recipient));
            sender.send(new EmailSender.RenderedEmail(
                    recipient.email(), rendered.subject(), rendered.html(), rendered.text()));
            delivery.markSent();
            sent.increment();
            latency.record(Duration.between(delivery.getCreatedAt(), Instant.now()));
        } catch (RuntimeException failure) {
            delivery.markFailed(failure.getClass().getSimpleName()
                    + ": " + String.valueOf(failure.getMessage()).replaceAll("[\\r\\n]", " "));
            failed.increment();
            log.warn("Email delivery {} attempt {} failed ({})",
                    delivery.getId(), delivery.getAttemptCount(), failure.getClass().getSimpleName());
        }
    }

    /** Template values: the recipient's CURRENT name + safe product context. */
    private Map<String, String> templateValues(
            EmailDelivery delivery, RecipientDirectory.Recipient recipient) {
        Map<String, String> values = new HashMap<>();
        values.put("name", recipient.fullName());
        values.put("plan", "");
        values.put("date", "");
        if (delivery.getNotificationId() != null) {
            notifications.findById(delivery.getNotificationId()).ifPresent(notification -> {
                try {
                    JsonNode context = MAPPER.readTree(notification.getContextJson());
                    if (context.path("plan").isTextual()) {
                        values.put("plan", context.path("plan").asText());
                    }
                    if (context.path("periodEnd").isTextual()) {
                        values.put("date", DATE.format(
                                Instant.parse(context.path("periodEnd").asText())));
                    }
                } catch (Exception ignored) {
                    // Context is best-effort render data; the email still sends.
                }
            });
        }
        return values;
    }
}
