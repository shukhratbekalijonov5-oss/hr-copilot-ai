package ai.hrcopilot.notification;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;
import org.springframework.scheduling.annotation.EnableScheduling;

/**
 * HR Copilot AI — Notification Service.
 *
 * The authoritative owner of user notifications: the rows, the read/unread
 * state, channel classification, email delivery state and SMTP sending.
 * Consumes trusted domain events from Kafka (the backend's notification
 * outbox and the Payment Service's billing topics), persists exactly-once
 * by database constraint, echoes created rows back to Kafka for the
 * backend's websocket bridge, and delivers the THREE product emails —
 * account created, subscription activated, subscription expiring in three
 * days — to the recipient's CURRENT account address, resolved from the
 * backend at send time, never from a stored snapshot.
 *
 * This service's PostgreSQL database is the notification source of truth.
 * It is deliberately NOT a billing authority: the expiry scheduler asks the
 * Payment Service who is due and stores only the reminder it sent.
 */
@SpringBootApplication
@EnableScheduling
@ConfigurationPropertiesScan
public class NotificationServiceApplication {
    public static void main(String[] args) {
        SpringApplication.run(NotificationServiceApplication.class, args);
    }
}
