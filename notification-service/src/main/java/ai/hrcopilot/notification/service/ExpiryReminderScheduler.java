package ai.hrcopilot.notification.service;

import ai.hrcopilot.notification.config.NotificationServiceProperties;
import ai.hrcopilot.notification.domain.ChannelPolicy;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * The 3-days-before-expiry reminder.
 *
 * Billing truth stays in the Payment Service: every tick ASKS its internal
 * API which paid subscriptions end inside the window, then records exactly
 * one reminder per (subscription, period end) — the deterministic event id
 * `expiry:{subscriptionId}:{periodEnd}` meets the database unique
 * constraint, so a rerun, a restart, or a second replica cannot produce a
 * second reminder for the same period, and a RENEWED period (new period
 * end) naturally earns a fresh one. No JVM-memory dedupe anywhere.
 */
@Component
public class ExpiryReminderScheduler {

    private static final Logger log = LoggerFactory.getLogger(ExpiryReminderScheduler.class);
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final NotificationServiceProperties properties;
    private final NotificationIngestService ingest;
    private final HttpClient http;

    public ExpiryReminderScheduler(
            NotificationServiceProperties properties, NotificationIngestService ingest) {
        this.properties = properties;
        this.ingest = ingest;
        this.http = HttpClient.newBuilder()
                .version(HttpClient.Version.HTTP_1_1)
                .connectTimeout(Duration.ofMillis(properties.lookupTimeoutMs()))
                .build();
    }

    @Scheduled(fixedDelayString = "${notification.expiry-poll-ms:900000}")
    public void tick() {
        if (!properties.expiryEnabled()) {
            return;
        }
        runOnce();
    }

    /** One pass; also the operational/manual trigger. Returns reminders recorded. */
    public int runOnce() {
        String base = properties.paymentBaseUrl();
        String token = properties.paymentToken();
        if (base == null || base.isBlank() || token == null || token.isBlank()) {
            log.warn("Expiry scheduler has no Payment Service configuration; skipping");
            return 0;
        }
        JsonNode due;
        try {
            HttpRequest request = HttpRequest.newBuilder(URI.create(
                            base.replaceAll("/+$", "")
                                    + "/internal/subscriptions/expiring?withinDays="
                                    + properties.expiryWindowDays()))
                    .timeout(Duration.ofMillis(properties.lookupTimeoutMs()))
                    .header("X-Internal-Token", token)
                    .GET()
                    .build();
            HttpResponse<String> response =
                    http.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() != 200) {
                log.warn("Payment Service answered {} for the expiring read", response.statusCode());
                return 0;
            }
            due = MAPPER.readTree(response.body()).path("subscriptions");
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            return 0;
        } catch (Exception transport) {
            log.warn("Expiring-subscriptions read failed ({})", transport.getClass().getSimpleName());
            return 0;
        }
        if (!due.isArray()) {
            return 0;
        }

        int recorded = 0;
        for (JsonNode subscription : due) {
            String userId = subscription.path("userId").asText(null);
            String subscriptionId = subscription.path("subscriptionId").asText(null);
            String periodEnd = subscription.path("currentPeriodEnd").asText(null);
            String plan = subscription.path("plan").asText("");
            if (userId == null || subscriptionId == null || periodEnd == null) {
                continue;
            }
            ObjectNode context = MAPPER.createObjectNode();
            context.put("audience", "CANDIDATE");
            context.put("plan", plan);
            context.put("periodEnd", periodEnd);

            NotificationIngestService.Outcome outcome = ingest.ingest(
                    new NotificationIngestService.IngestRequest(
                            "expiry:" + subscriptionId + ":" + periodEnd,
                            ChannelPolicy.SUBSCRIPTION_EXPIRES_IN_3_DAYS,
                            userId,
                            null,
                            "CANDIDATE",
                            context.toString()));
            if (outcome == NotificationIngestService.Outcome.PROCESSED) {
                recorded += 1;
            }
        }
        if (recorded > 0) {
            log.info("Expiry scheduler recorded {} new reminder(s)", recorded);
        }
        return recorded;
    }
}
