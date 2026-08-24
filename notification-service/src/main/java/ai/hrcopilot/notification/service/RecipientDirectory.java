package ai.hrcopilot.notification.service;

import ai.hrcopilot.notification.config.NotificationServiceProperties;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/**
 * Resolves a userId to the CURRENT account identity — email, name, locale —
 * by asking the backend at SEND time. This lookup is the entire mechanism
 * behind "a changed profile email changes future delivery": no address is
 * ever persisted as delivery authority, so a retry after an address change
 * automatically goes to the new address.
 *
 * Outcomes are explicit: FOUND carries the identity; MISSING means the user
 * no longer exists (permanent — nobody to email); UNAVAILABLE means the
 * truth could not be read right now (retryable). The resolved email is
 * shape-checked before use and never logged.
 */
@Service
public class RecipientDirectory {

    public enum Status {
        FOUND,
        MISSING,
        UNAVAILABLE
    }

    public record Resolution(Status status, Recipient recipient) {
        public static Resolution found(Recipient recipient) {
            return new Resolution(Status.FOUND, recipient);
        }

        public static Resolution missing() {
            return new Resolution(Status.MISSING, null);
        }

        public static Resolution unavailable() {
            return new Resolution(Status.UNAVAILABLE, null);
        }
    }

    public record Recipient(String userId, String email, String fullName, String locale) {
    }

    private static final Logger log = LoggerFactory.getLogger(RecipientDirectory.class);
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final NotificationServiceProperties properties;
    private final HttpClient http;

    public RecipientDirectory(NotificationServiceProperties properties) {
        this.properties = properties;
        // HTTP/1.1 explicitly: the default h2c Upgrade dance is eaten by the
        // backend's websocket upgrade handling and yields an empty response.
        this.http = HttpClient.newBuilder()
                .version(HttpClient.Version.HTTP_1_1)
                .connectTimeout(Duration.ofMillis(properties.lookupTimeoutMs()))
                .build();
    }

    public Resolution resolve(String userId) {
        String base = properties.backendBaseUrl();
        String token = properties.backendToken();
        if (base == null || base.isBlank() || token == null || token.isBlank()) {
            return Resolution.unavailable(); // Unconfigured never guesses.
        }
        try {
            HttpRequest request = HttpRequest.newBuilder(URI.create(
                            base.replaceAll("/+$", "")
                                    + "/internal/notification-users/"
                                    + URLEncoder.encode(userId, StandardCharsets.UTF_8)))
                    .timeout(Duration.ofMillis(properties.lookupTimeoutMs()))
                    .header("X-Internal-Token", token)
                    .GET()
                    .build();
            HttpResponse<String> response =
                    http.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() == 404) {
                return Resolution.missing();
            }
            if (response.statusCode() != 200) {
                log.warn("Recipient lookup answered {}", response.statusCode());
                return Resolution.unavailable();
            }
            JsonNode body = MAPPER.readTree(response.body());
            String email = body.path("email").asText(null);
            String echoedId = body.path("userId").asText(null);
            if (!userId.equals(echoedId) || !isPlausibleEmail(email)) {
                return Resolution.unavailable(); // Shape is validated, not trusted.
            }
            return Resolution.found(new Recipient(
                    userId,
                    email,
                    body.path("fullName").asText(""),
                    body.path("locale").asText("en")));
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            return Resolution.unavailable();
        } catch (Exception transport) {
            // Class name only — never the URL, never an address.
            log.warn("Recipient lookup failed ({})", transport.getClass().getSimpleName());
            return Resolution.unavailable();
        }
    }

    /** Minimal shape check; header-injection characters disqualify outright. */
    private static boolean isPlausibleEmail(String email) {
        return email != null
                && email.length() <= 320
                && email.indexOf('@') > 0
                && email.indexOf('@') == email.lastIndexOf('@')
                && !email.matches(".*[\\r\\n\\s].*");
    }
}
