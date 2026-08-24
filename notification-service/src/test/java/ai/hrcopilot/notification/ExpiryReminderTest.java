package ai.hrcopilot.notification;

import static org.assertj.core.api.Assertions.assertThat;

import ai.hrcopilot.notification.repository.EmailDeliveryRepository;
import ai.hrcopilot.notification.repository.NotificationRepository;
import ai.hrcopilot.notification.service.ExpiryReminderScheduler;
import ai.hrcopilot.notification.support.IntegrationTestBase;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * The 3-day reminder: exactly one per (subscription, period end) no matter
 * how often the scheduler runs or restarts — a renewed period earns a new
 * one. The Payment Service is faked at the HTTP boundary; billing truth
 * never lives here.
 */
class ExpiryReminderTest extends IntegrationTestBase {

    private static final String SUB_ID = UUID.randomUUID().toString();
    private static final String USER = "expiry-user-" + UUID.randomUUID();
    private static volatile String periodEnd = "2026-08-28T10:00:00Z";

    private static final HttpServer PAYMENT = startFakePayment();

    private static HttpServer startFakePayment() {
        try {
            HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
            server.createContext("/internal/subscriptions/expiring", exchange -> {
                String token = exchange.getRequestHeaders().getFirst("X-Internal-Token");
                String body = "payment-token".equals(token)
                        ? "{\"withinDays\":3,\"subscriptions\":[{\"userId\":\"" + USER
                                + "\",\"subscriptionId\":\"" + SUB_ID
                                + "\",\"plan\":\"PRO\",\"currentPeriodEnd\":\"" + periodEnd + "\"}]}"
                        : "{\"error\":\"unauthorized\"}";
                byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
                exchange.sendResponseHeaders("payment-token".equals(token) ? 200 : 401, bytes.length);
                exchange.getResponseBody().write(bytes);
                exchange.close();
            });
            server.start();
            return server;
        } catch (IOException error) {
            throw new IllegalStateException(error);
        }
    }

    @DynamicPropertySource
    static void paymentProperties(DynamicPropertyRegistry registry) {
        registry.add("notification.payment-base-url",
                () -> "http://127.0.0.1:" + PAYMENT.getAddress().getPort());
        registry.add("notification.payment-token", () -> "payment-token");
    }

    @AfterAll
    static void stop() {
        PAYMENT.stop(0);
    }

    @Autowired
    private ExpiryReminderScheduler scheduler;

    @Autowired
    private NotificationRepository notifications;

    @Autowired
    private EmailDeliveryRepository deliveries;

    @Test
    void oneReminderPerPeriodHoweverOftenTheSchedulerRuns() {
        assertThat(scheduler.runOnce()).isEqualTo(1);
        assertThat(scheduler.runOnce()).isZero(); // rerun: nothing new
        assertThat(scheduler.runOnce()).isZero(); // restart-equivalent: still nothing

        String eventId = "expiry:" + SUB_ID + ":" + periodEnd;
        var notification = notifications.findByEventId(eventId).orElseThrow();
        assertThat(notification.getType()).isEqualTo("SUBSCRIPTION_EXPIRES_IN_3_DAYS");
        assertThat(notification.getRecipientUserId()).isEqualTo(USER);
        assertThat(deliveries.findByEventIdAndEmailType(eventId, "SUBSCRIPTION_EXPIRES_IN_3_DAYS"))
                .isPresent();

        // A RENEWED period (new period end) legitimately earns a new reminder.
        periodEnd = "2026-09-27T10:00:00Z";
        assertThat(scheduler.runOnce()).isEqualTo(1);
        assertThat(scheduler.runOnce()).isZero();
    }
}
