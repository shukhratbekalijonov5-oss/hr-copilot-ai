package ai.hrcopilot.notification;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import ai.hrcopilot.notification.email.EmailSender;
import ai.hrcopilot.notification.email.PermanentEmailException;
import ai.hrcopilot.notification.repository.EmailDeliveryRepository;
import ai.hrcopilot.notification.repository.NotificationRepository;
import ai.hrcopilot.notification.service.EmailDeliveryWorker;
import ai.hrcopilot.notification.service.NotificationIngestService;
import ai.hrcopilot.notification.service.RecipientDirectory;
import ai.hrcopilot.notification.support.IntegrationTestBase;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

/**
 * THE ISOLATION PROOF for external email.
 *
 * ChannelPolicy already declares which events may email; this test proves
 * the declaration end-to-end at the only place that matters — the provider
 * boundary. Every unrelated product event is ingested for real, the
 * delivery worker is run for real, and the email provider is then asserted
 * to have been called ZERO times. No routing table is trusted here: the
 * mock either saw a send or it did not.
 */
class EmailAllowlistTest extends IntegrationTestBase {

    /**
     * Everything the product notifies about that must stay in-app forever.
     * Adding a type here costs nothing; adding one that emails fails.
     */
    private static final String[] MUST_NEVER_EMAIL = {
        "NEW_APPLICATION",
        "APPLICATION_STAGE_CHANGED",
        "APPLICATION_REJECTED",
        "INTERVIEW_INVITATION",
        "STRONG_AI_JOB_MATCH",
        "NEW_MESSAGE",
        "NEW_CALL",
        "VACANCY_DELETED",
        "VACANCY_UPDATED",
        "RESUME_PROCESSING_COMPLETED",
        "DOCUMENT_PROCESSING_FAILED",
        "CANDIDATE_WITHDREW",
        "AI_PROCESSING_ERROR",
        "SYSTEM_NOTICE",
        // A type a NEWER producer might invent: unknown must also be silent.
        "SOME_TYPE_THIS_DEPLOY_HAS_NEVER_SEEN",
    };

    private static final String[] MAY_EMAIL = {
        "ACCOUNT_CREATED", "SUBSCRIPTION_ACTIVATED", "SUBSCRIPTION_EXPIRES_IN_3_DAYS"
    };

    @MockitoBean
    private EmailSender sender;

    @MockitoBean
    private RecipientDirectory recipients;

    @Autowired
    private EmailDeliveryWorker worker;

    @Autowired
    private NotificationIngestService ingest;

    @Autowired
    private EmailDeliveryRepository deliveries;

    @Autowired
    private NotificationRepository notifications;

    @Autowired
    private org.springframework.jdbc.core.JdbcTemplate jdbc;

    @BeforeEach
    void stubProvider() {
        Mockito.lenient().when(sender.name()).thenReturn("RESEND");
        Mockito.lenient().when(recipients.resolve(Mockito.anyString())).thenAnswer(call ->
                RecipientDirectory.Resolution.found(new RecipientDirectory.Recipient(
                        call.getArgument(0), "person@example.test", "Jasur", "en")));
        quiescePreexistingDeliveries();
    }

    /**
     * The database is shared across test classes, so a delivery another
     * class enqueued and never sent would be picked up by THIS class's
     * worker run and pollute an "exactly N sends" assertion. Settling them
     * first makes every count below mean strictly what this test did.
     */
    private void quiescePreexistingDeliveries() {
        jdbc.update("UPDATE email_deliveries SET status = 'SENT', sent_at = now(), "
                + "next_attempt_at = NULL WHERE status IN ('PENDING', 'FAILED_RETRYABLE')");
    }


    private String ingestOne(String type) {
        String eventId = "evt-" + UUID.randomUUID();
        ingest.ingest(new NotificationIngestService.IngestRequest(
                eventId, type, "user-" + UUID.randomUUID(), null, "CANDIDATE",
                "{\"plan\":\"MAX\",\"periodEnd\":\"2026-09-30T00:00:00Z\"}"));
        return eventId;
    }

    @Test
    void noUnrelatedProductEventEverReachesTheEmailProvider() {
        long deliveriesBefore = deliveries.count();

        for (String type : MUST_NEVER_EMAIL) {
            ingestOne(type);
        }
        // Run the worker to completion: if any of those created a delivery
        // row, this is where it would be handed to the provider.
        worker.deliverDue();
        worker.deliverDue();

        verify(sender, never()).send(any());
        assertThat(deliveries.count())
                .as("not one email delivery row from %d in-app events", MUST_NEVER_EMAIL.length)
                .isEqualTo(deliveriesBefore);
    }

    @Test
    void eachOfTheThreeAllowedEventsSendsExactlyOneEmail() {
        when(sender.send(any())).thenReturn(new EmailSender.Receipt("msg_ok"));

        for (String type : MAY_EMAIL) {
            String eventId = ingestOne(type);
            assertThat(deliveries.findByEventIdAndEmailType(eventId, type))
                    .as(type + " must enqueue exactly one email")
                    .isPresent();
        }
        worker.deliverDue();

        verify(sender, Mockito.times(MAY_EMAIL.length)).send(any());
        // A second sweep must not re-send anything already settled.
        worker.deliverDue();
        verify(sender, Mockito.times(MAY_EMAIL.length)).send(any());
    }

    @Test
    void aProviderRejectionIsTerminalImmediatelyAndCostsNoRetries() {
        when(sender.send(any()))
                .thenThrow(new PermanentEmailException("Resend HTTP 422 (validation_error)"));
        String eventId = ingestOne("SUBSCRIPTION_ACTIVATED");

        worker.deliverDue();

        var delivery = deliveries
                .findByEventIdAndEmailType(eventId, "SUBSCRIPTION_ACTIVATED").orElseThrow();
        assertThat(delivery.getStatus()).isEqualTo("FAILED_PERMANENT");
        assertThat(delivery.getAttemptCount()).isEqualTo(1); // NOT the 5-rung ladder
        assertThat(delivery.getNextAttemptAt()).isNull();
        assertThat(delivery.getLastError()).contains("422");

        // And the business fact is untouched: the in-app notification for the
        // very same event is still there, unread, exactly as produced.
        var notification = notifications.findByEventId(eventId).orElseThrow();
        assertThat(notification.getType()).isEqualTo("SUBSCRIPTION_ACTIVATED");
        assertThat(notification.isRead()).isFalse();

        // Repeated sweeps never touch it again — no hot retry loop.
        worker.deliverDue();
        worker.deliverDue();
        verify(sender, Mockito.times(1)).send(any());
    }
}
