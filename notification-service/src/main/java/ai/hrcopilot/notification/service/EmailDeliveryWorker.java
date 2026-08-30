package ai.hrcopilot.notification.service;

import ai.hrcopilot.notification.config.NotificationServiceProperties;
import ai.hrcopilot.notification.domain.ChannelPolicy;
import ai.hrcopilot.notification.domain.entity.EmailDelivery;
import ai.hrcopilot.notification.email.EmailSender;
import ai.hrcopilot.notification.email.EmailTemplates;
import ai.hrcopilot.notification.email.PermanentEmailException;
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
import java.util.Set;
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
 * hot-retried. Some failures skip the ladder entirely because no retry
 * could ever succeed: a missing recipient (deleted account), and a
 * PermanentEmailException from the provider (rejected address, unverified
 * sending domain, revoked credential — every non-429 4xx). An unreadable
 * backend, a rate limit, a provider outage or a down SMTP host stay
 * retryable. In-app notifications are entirely unaffected by anything here,
 * and so is the business transaction that produced the email: signup and
 * payment committed long before this worker ever ran.
 */
@Component
public class EmailDeliveryWorker {

    private static final Logger log = LoggerFactory.getLogger(EmailDeliveryWorker.class);
    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final DateTimeFormatter DATE =
            DateTimeFormatter.ofPattern("yyyy-MM-dd").withZone(ZoneOffset.UTC);
    /** Currencies with no minor unit — the amount IS the major value. */
    private static final Set<String> ZERO_DECIMAL =
            Set.of("KRW", "JPY", "VND", "CLP", "ISK", "UGX", "XAF", "XOF");

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
            EmailSender.Receipt receipt = sender.send(new EmailSender.RenderedEmail(
                    delivery.getId().toString(),
                    recipient.email(),
                    rendered.subject(),
                    rendered.html(),
                    rendered.text()));
            delivery.markSent(sender.name(), receipt.providerMessageId());
            sent.increment();
            latency.record(Duration.between(delivery.getCreatedAt(), Instant.now()));
        } catch (PermanentEmailException rejected) {
            // The provider refused the REQUEST, not the moment. Retrying
            // five more times would only repeat the rejection.
            delivery.markPermanentlyFailed(sanitize(rejected.getMessage()));
            failed.increment();
            log.warn("Email delivery {} permanently rejected by {}",
                    delivery.getId(), sender.name());
        } catch (RuntimeException failure) {
            delivery.markFailed(failure.getClass().getSimpleName()
                    + ": " + sanitize(failure.getMessage()));
            failed.increment();
            log.warn("Email delivery {} attempt {} failed ({})",
                    delivery.getId(), delivery.getAttemptCount(), failure.getClass().getSimpleName());
        }
    }

    /**
     * Template values: the recipient's CURRENT name, the ONE configured
     * link for this email type, and whatever authoritative facts the
     * producing event actually carried.
     *
     * Every `detail.*` entry is conditional by construction — a fact the
     * Payment Service did not state is simply absent, and the template
     * renders no row for it. Nothing here invents a price, a date or a
     * status.
     */
    private Map<String, String> templateValues(
            EmailDelivery delivery, RecipientDirectory.Recipient recipient) {
        Map<String, String> values = new HashMap<>();
        values.put("name", recipient.fullName());
        values.put("plan", "");
        values.put("date", "");
        values.put("url", ctaUrlFor(delivery.getEmailType()));
        if (delivery.getNotificationId() != null) {
            notifications.findById(delivery.getNotificationId()).ifPresent(notification -> {
                try {
                    JsonNode context = MAPPER.readTree(notification.getContextJson());
                    if (context.path("plan").isTextual()) {
                        values.put("plan", context.path("plan").asText());
                        values.put("detail.plan", context.path("plan").asText());
                    }
                    if (context.path("periodEnd").isTextual()) {
                        String rendered = formatDate(context.path("periodEnd").asText());
                        values.put("date", rendered);
                        values.put("detail.end", rendered);
                    }
                    if (context.path("periodStart").isTextual()) {
                        values.put("detail.start", formatDate(context.path("periodStart").asText()));
                    }
                    if (context.path("status").isTextual()) {
                        values.put("detail.status", context.path("status").asText());
                    }
                    // Amount is stated ONLY when the producer gave both the
                    // number and its currency — a bare number is not a price.
                    if (context.path("amountMinor").isNumber()
                            && context.path("currency").isTextual()) {
                        values.put("detail.amount", formatAmount(
                                context.path("amountMinor").asLong(),
                                context.path("currency").asText()));
                    }
                } catch (Exception ignored) {
                    // Context is best-effort render data; the email still sends.
                }
            });
        }
        return values;
    }

    /**
     * The single call-to-action per email family. Welcome opens the product;
     * both subscription mails open the existing billing surface (/plans).
     */
    private String ctaUrlFor(String emailType) {
        String base = properties.appPublicUrl();
        return ChannelPolicy.ACCOUNT_CREATED.equals(emailType) ? base : base + "/plans";
    }

    /** ISO instant → yyyy-MM-dd in UTC; an unparseable value renders nothing. */
    private static String formatDate(String isoInstant) {
        try {
            return DATE.format(Instant.parse(isoInstant));
        } catch (Exception unparseable) {
            return "";
        }
    }

    /**
     * Minor units → a displayable amount. KRW (and the other zero-decimal
     * currencies this product prices in) has no minor unit at all: 9900 KRW
     * is ₩9,900, not ₩99.00.
     */
    private static String formatAmount(long minor, String currency) {
        String code = currency.replaceAll("[^A-Za-z]", "").toUpperCase();
        if (code.isEmpty()) {
            return "";
        }
        if (ZERO_DECIMAL.contains(code)) {
            return String.format("%,d %s", minor, code);
        }
        return String.format("%,.2f %s", minor / 100.0, code);
    }

    /** Sanitized, bounded provider/exception text for the delivery row. */
    private static String sanitize(String message) {
        return String.valueOf(message).replaceAll("[\\r\\n]", " ");
    }
}
