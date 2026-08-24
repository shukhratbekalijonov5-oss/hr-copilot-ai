package ai.hrcopilot.notification.service;

import ai.hrcopilot.notification.domain.ChannelPolicy;
import ai.hrcopilot.notification.domain.entity.EmailDelivery;
import ai.hrcopilot.notification.domain.entity.Notification;
import ai.hrcopilot.notification.events.NotificationTopics;
import ai.hrcopilot.notification.outbox.OutboxWriter;
import ai.hrcopilot.notification.repository.EmailDeliveryRepository;
import ai.hrcopilot.notification.repository.NotificationRepository;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import java.util.Map;
import java.util.UUID;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Turns one VERIFIED notification event into state — exactly once.
 *
 * Everything an event causes commits in ONE transaction: the notification
 * row (when the type routes in-app), the email delivery row (when the type
 * routes email — the THREE product emails only), and the created-echo
 * outbox event for the backend's realtime bridge. The `event_id` unique
 * constraints are the idempotency anchor: a redelivered Kafka message or a
 * re-run scheduler aborts the whole transaction and the caller reads
 * "duplicate", never a second row or a second email.
 *
 * The duplicate catch sits OUTSIDE the transaction boundary, same as the
 * Payment Service's webhook processing (and for the same self-invocation
 * reason).
 */
@Service
public class NotificationIngestService {

    public enum Outcome {
        PROCESSED,
        DUPLICATE
    }

    private final NotificationRepository notifications;
    private final EmailDeliveryRepository emails;
    private final OutboxWriter outbox;
    private final TransactionTemplate transactions;
    private final Counter created;
    private final Counter duplicates;

    public NotificationIngestService(
            NotificationRepository notifications,
            EmailDeliveryRepository emails,
            OutboxWriter outbox,
            TransactionTemplate transactions,
            MeterRegistry meters) {
        this.notifications = notifications;
        this.emails = emails;
        this.outbox = outbox;
        this.transactions = transactions;
        // Not "notification_created_total": OpenMetrics reserves the
        // `_created` suffix, and the Prometheus client silently rewrites such
        // names (→ notification_total). This name survives verbatim.
        this.created = Counter.builder("notification_created_count").register(meters);
        this.duplicates = Counter.builder("notification_duplicate_total").register(meters);
    }

    public record IngestRequest(
            String eventId,
            String type,
            String recipientUserId,
            String organizationId,
            String audience,
            String contextJson) {
    }

    public Outcome ingest(IngestRequest request) {
        try {
            Outcome outcome = transactions.execute(ignored -> ingestOnce(request));
            if (outcome == Outcome.PROCESSED) {
                created.increment();
            }
            return outcome;
        } catch (DataIntegrityViolationException alreadySeen) {
            duplicates.increment();
            return Outcome.DUPLICATE;
        }
    }

    private Outcome ingestOnce(IngestRequest request) {
        ChannelPolicy.Route route = ChannelPolicy.effectiveRouteOf(request.type());

        Notification notification = null;
        if (route.inApp()) {
            notification = notifications.save(Notification.of(
                    request.eventId(),
                    request.recipientUserId(),
                    request.organizationId(),
                    request.audience(),
                    request.type(),
                    request.contextJson()));
            // The realtime echo commits WITH the row; the backend bridge can
            // never announce a notification that does not exist.
            outbox.append(
                    NotificationTopics.NOTIFICATION_CREATED,
                    "notification",
                    notification.getId().toString(),
                    "NOTIFICATION_CREATED",
                    request.recipientUserId(),
                    Map.of("notification", NotificationViews.toView(notification)));
        }

        if (route.email()) {
            UUID notificationId = notification == null ? null : notification.getId();
            emails.save(EmailDelivery.pending(
                    notificationId,
                    request.eventId(),
                    request.type(),
                    request.recipientUserId()));
        }

        if (!route.inApp() && !route.email()) {
            // Unreachable under the current policy (unknown → in-app), kept
            // for the day a type is deliberately routed nowhere.
            return Outcome.PROCESSED;
        }
        return Outcome.PROCESSED;
    }
}
