package ai.hrcopilot.notification;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import ai.hrcopilot.notification.config.NotificationServiceProperties;
import ai.hrcopilot.notification.email.EmailSender;
import ai.hrcopilot.notification.email.PermanentEmailException;
import ai.hrcopilot.notification.email.ResendEmailSender;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * The Resend adapter against a REAL HTTP server standing in for the
 * provider — never the internet. What is proven here is the whole contract
 * the delivery worker depends on: the request shape, the receipt, and above
 * all the retryable/permanent split that decides whether a failed email
 * costs five more attempts or none.
 */
class ResendEmailSenderTest {

    private static final AtomicInteger STATUS = new AtomicInteger(200);
    private static final AtomicReference<String> BODY =
            new AtomicReference<>("{\"id\":\"3f1e...\"}");
    private static final List<String> REQUEST_BODIES = new ArrayList<>();
    private static final List<String> AUTH_HEADERS = new ArrayList<>();
    private static final List<String> IDEMPOTENCY_KEYS = new ArrayList<>();

    private static final HttpServer RESEND = start();

    private static HttpServer start() {
        try {
            HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
            server.createContext("/emails", ResendEmailSenderTest::handle);
            server.start();
            return server;
        } catch (IOException error) {
            throw new IllegalStateException(error);
        }
    }

    private static void handle(HttpExchange exchange) throws IOException {
        REQUEST_BODIES.add(new String(
                exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
        AUTH_HEADERS.add(String.valueOf(exchange.getRequestHeaders().getFirst("Authorization")));
        IDEMPOTENCY_KEYS.add(String.valueOf(exchange.getRequestHeaders().getFirst("Idempotency-Key")));
        byte[] bytes = BODY.get().getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().add("Content-Type", "application/json");
        exchange.sendResponseHeaders(STATUS.get(), bytes.length);
        exchange.getResponseBody().write(bytes);
        exchange.close();
    }

    @AfterAll
    static void stop() {
        RESEND.stop(0);
    }

    @BeforeEach
    void reset() {
        STATUS.set(200);
        BODY.set("{\"id\":\"3f1e-msg-id\"}");
        REQUEST_BODIES.clear();
        AUTH_HEADERS.clear();
        IDEMPOTENCY_KEYS.clear();
    }

    private ResendEmailSender sender() {
        return sender("http://127.0.0.1:" + RESEND.getAddress().getPort() + "/emails");
    }

    private ResendEmailSender sender(String url) {
        return new ResendEmailSender(new NotificationServiceProperties(
                "internal", "", "", "", "",
                NotificationServiceProperties.Provider.RESEND,
                "re_test_key_not_real", url,
                "HR Copilot AI <no-reply@hrcopilot.cloud>",
                "no-reply@hrcopilot.cloud", "HR Copilot AI",
                "https://hrcopilot.cloud", 2_000,
                2_000, 10, 500, 50, false, false, 900_000, 3, 2_000));
    }

    private EmailSender.RenderedEmail email() {
        return new EmailSender.RenderedEmail(
                "11111111-2222-3333-4444-555555555555",
                "person@example.test",
                "Welcome to HR Copilot AI",
                "<p>hello</p>",
                "hello");
    }

    @Test
    void aSuccessfulSendReturnsTheProviderMessageIdAndSendsTheRightRequest() {
        EmailSender.Receipt receipt = sender().send(email());

        assertThat(receipt.providerMessageId()).isEqualTo("3f1e-msg-id");
        assertThat(REQUEST_BODIES).hasSize(1);
        String body = REQUEST_BODIES.get(0);
        assertThat(body).contains("\"from\":\"HR Copilot AI <no-reply@hrcopilot.cloud>\"");
        assertThat(body).contains("\"to\":[\"person@example.test\"]");
        assertThat(body).contains("Welcome to HR Copilot AI");
        // Both parts always travel; no provider-side templating is used.
        assertThat(body).contains("\"html\"").contains("\"text\"");
        assertThat(AUTH_HEADERS.get(0)).startsWith("Bearer ");
        // The delivery row id is the idempotency key: a retry after a lost
        // response is de-duplicated BY THE PROVIDER, not by luck.
        assertThat(IDEMPOTENCY_KEYS.get(0)).isEqualTo("11111111-2222-3333-4444-555555555555");
    }

    @Test
    void aValidationRejectionIsPermanentAndNeverRetried() {
        STATUS.set(422);
        BODY.set("{\"statusCode\":422,\"name\":\"validation_error\","
                + "\"message\":\"Invalid `to` field\"}");

        assertThatThrownBy(() -> sender().send(email()))
                .isInstanceOf(PermanentEmailException.class)
                .hasMessageContaining("422")
                .hasMessageContaining("validation_error")
                // The provider's echoed message is NOT propagated: it repeats
                // request fields, and this string lands in the database.
                .hasMessageNotContaining("Invalid `to` field");
    }

    @Test
    void anInvalidApiKeyIsPermanentAndTheKeyItselfNeverAppearsInTheFailure() {
        STATUS.set(401);
        BODY.set("{\"name\":\"validation_error\",\"message\":\"API key is invalid\"}");

        assertThatThrownBy(() -> sender().send(email()))
                .isInstanceOf(PermanentEmailException.class)
                .hasMessageNotContaining("re_test_key_not_real");
    }

    @Test
    void rateLimitsAndOutagesStayRetryable() {
        for (int status : new int[] {429, 408, 500, 503}) {
            STATUS.set(status);
            BODY.set("{\"name\":\"rate_limit_exceeded\"}");
            assertThatThrownBy(() -> sender().send(email()))
                    .as("HTTP " + status + " must remain retryable")
                    .isInstanceOf(IllegalStateException.class)
                    .isNotInstanceOf(PermanentEmailException.class);
        }
    }

    @Test
    void aTransportFailureIsRetryableAndLeaksNothing() {
        // Port 1 on loopback: nothing listens, so the connection is refused.
        assertThatThrownBy(() -> sender("http://127.0.0.1:1/emails").send(email()))
                .isInstanceOf(IllegalStateException.class)
                .isNotInstanceOf(PermanentEmailException.class)
                .hasMessageContaining("Resend transport failure")
                .hasMessageNotContaining("re_test_key_not_real");
    }

    @Test
    void anUnparseableSuccessBodyIsStillASuccess() {
        BODY.set("not json at all");
        EmailSender.Receipt receipt = sender().send(email());
        // The mail WAS accepted; we simply have no id to record for it.
        assertThat(receipt.providerMessageId()).isNull();
    }

    @Test
    void aHostileErrorNameCannotSmuggleAnythingIntoTheDeliveryRow() {
        STATUS.set(400);
        BODY.set("{\"name\":\"bad\\r\\nInjected: 1 <script>\"}");
        assertThatThrownBy(() -> sender().send(email()))
                .isInstanceOf(PermanentEmailException.class)
                .hasMessageNotContaining("<script>")
                .hasMessageNotContaining("\r");
    }
}
