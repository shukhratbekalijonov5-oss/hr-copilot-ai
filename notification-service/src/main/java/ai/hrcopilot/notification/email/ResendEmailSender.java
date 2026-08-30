package ai.hrcopilot.notification.email;

import ai.hrcopilot.notification.config.NotificationServiceProperties;
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

/**
 * Production email delivery through the Resend HTTPS API — the ONLY place
 * in the codebase that knows Resend exists. Everything upstream (the
 * channel policy, the three templates, the delivery worker's state machine)
 * is provider-agnostic and unchanged.
 *
 * ## The API key
 *
 * Arrives from the environment as RESEND_API_KEY and lives only in this
 * object's field. It is written into one Authorization header and NEVER
 * anywhere else: not into a log line, not into an exception message, not
 * into the delivery row's last_error, not into a metric label. The error
 * paths below log status codes and provider error NAMES only, deliberately
 * never the request or the response body — a Resend error body echoes
 * request fields, and this class treats every provider string as untrusted.
 *
 * ## Idempotency
 *
 * Each send carries `Idempotency-Key: <email_deliveries.id>`. That row id is
 * stable across every attempt of the same logical email, so if a send
 * SUCCEEDS at Resend but the response is lost in transit (timeout, pod
 * eviction), the worker's retry is de-duplicated by the provider instead of
 * delivering a second copy to the user's inbox.
 *
 * ## Failure classification (the retry contract)
 *
 * 2xx                     → Receipt with the provider message id
 * 408, 429                → retryable (rate limited / provider-side timeout)
 * other 4xx               → PERMANENT (bad address, unverified domain, bad key)
 * 5xx                     → retryable (provider outage)
 * transport / timeout     → retryable
 *
 * A permanently-failed email never consumes the backoff ladder, and no
 * failure of any kind can affect the business transaction that produced it:
 * this class runs in the asynchronous delivery worker, long after signup or
 * payment committed.
 */
public class ResendEmailSender implements EmailSender {

    private static final Logger log = LoggerFactory.getLogger(ResendEmailSender.class);
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final NotificationServiceProperties properties;
    private final HttpClient http;

    public ResendEmailSender(NotificationServiceProperties properties) {
        this.properties = properties;
        this.http = HttpClient.newBuilder()
                .version(HttpClient.Version.HTTP_1_1)
                .connectTimeout(Duration.ofMillis(properties.emailSendTimeoutMs()))
                .build();
    }

    @Override
    public String name() {
        return "RESEND";
    }

    @Override
    public Receipt send(RenderedEmail email) {
        HttpResponse<String> response;
        try {
            response = http.send(request(email), HttpResponse.BodyHandlers.ofString());
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            // A shutdown mid-send is not the email's fault: stay retryable.
            throw new IllegalStateException("Resend send interrupted");
        } catch (Exception transport) {
            // Class name only. The URL carries no secret, but the exception
            // message can echo request context, so it is not propagated.
            throw new IllegalStateException(
                    "Resend transport failure: " + transport.getClass().getSimpleName());
        }

        int status = response.statusCode();
        if (status >= 200 && status < 300) {
            return new Receipt(messageIdOf(response.body()));
        }
        String reason = errorNameOf(response.body());
        if (status == 429 || status == 408 || status >= 500) {
            log.warn("Resend answered {} ({}); delivery stays retryable", status, reason);
            throw new IllegalStateException("Resend HTTP " + status + " (" + reason + ")");
        }
        log.warn("Resend REJECTED the request with {} ({}); delivery is permanent", status, reason);
        throw new PermanentEmailException("Resend HTTP " + status + " (" + reason + ")");
    }

    private HttpRequest request(RenderedEmail email) {
        ObjectNode body = MAPPER.createObjectNode();
        body.put("from", properties.fromHeader());
        body.putArray("to").add(email.toEmail());
        body.put("subject", email.subject());
        body.put("html", email.html());
        body.put("text", email.text());

        HttpRequest.Builder request = HttpRequest.newBuilder(
                        URI.create(properties.resendApiUrl()))
                .timeout(Duration.ofMillis(properties.emailSendTimeoutMs()))
                .header("Authorization", "Bearer " + properties.resendApiKey())
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(body.toString()));
        if (email.deliveryId() != null && !email.deliveryId().isBlank()) {
            request.header("Idempotency-Key", email.deliveryId());
        }
        return request.build();
    }

    /** The provider message id, or null when the body is not what we expect. */
    private static String messageIdOf(String rawBody) {
        try {
            JsonNode parsed = MAPPER.readTree(rawBody);
            String id = parsed.path("id").asText(null);
            return (id == null || id.isBlank()) ? null : id;
        } catch (Exception unparseable) {
            // A 2xx we cannot parse is still a delivered email — the receipt
            // is simply anonymous. Never fail a successful send on parsing.
            return null;
        }
    }

    /**
     * The provider's error NAME ("validation_error", "rate_limit_exceeded").
     * Deliberately not the message: those echo request fields back, and this
     * string is persisted on the delivery row.
     */
    private static String errorNameOf(String rawBody) {
        try {
            String name = MAPPER.readTree(rawBody).path("name").asText(null);
            if (name == null || name.isBlank() || name.length() > 64) {
                return "unspecified";
            }
            return name.replaceAll("[^a-zA-Z0-9_.-]", "");
        } catch (Exception unparseable) {
            return "unspecified";
        }
    }
}
