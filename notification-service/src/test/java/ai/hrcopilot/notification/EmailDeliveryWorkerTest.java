package ai.hrcopilot.notification;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import ai.hrcopilot.notification.email.EmailSender;
import ai.hrcopilot.notification.repository.EmailDeliveryRepository;
import ai.hrcopilot.notification.service.EmailDeliveryWorker;
import ai.hrcopilot.notification.service.NotificationIngestService;
import ai.hrcopilot.notification.service.RecipientDirectory;
import ai.hrcopilot.notification.support.IntegrationTestBase;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

/**
 * The email pipeline's state machine: current-address resolution at send
 * time, the retry ladder, permanent failures, and the in-app row's total
 * indifference to all of it.
 */
class EmailDeliveryWorkerTest extends IntegrationTestBase {

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
    private JdbcTemplate jdbc;

    @org.junit.jupiter.api.BeforeEach
    void nameTheProvider() {
        org.mockito.Mockito.lenient().when(sender.name()).thenReturn("TESTPROVIDER");
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


    private RecipientDirectory.Resolution found(String userId, String email) {
        return RecipientDirectory.Resolution.found(
                new RecipientDirectory.Recipient(userId, email, "Jasur T", "en"));
    }

    private String enqueue(String type) {
        String user = "worker-" + UUID.randomUUID();
        String eventId = "evt-" + UUID.randomUUID();
        ingest.ingest(new NotificationIngestService.IngestRequest(
                eventId, type, user, null, "CANDIDATE",
                "{\"plan\":\"MAX\",\"periodEnd\":\"2026-08-28T10:00:00Z\"}"));
        return eventId;
    }

    private void makeDue(String eventId) {
        jdbc.update("UPDATE email_deliveries SET next_attempt_at = now() - interval '1 second' "
                + "WHERE event_id = ?", eventId);
    }

    @Test
    void aSendGoesToTheCurrentAddressAndSettlesSent() {
        String eventId = enqueue("SUBSCRIPTION_ACTIVATED");
        String user = deliveries.findByEventIdAndEmailType(eventId, "SUBSCRIPTION_ACTIVATED")
                .orElseThrow().getRecipientUserId();
        when(recipients.resolve(user)).thenReturn(found(user, "current@example.test"));
        doReturn(new EmailSender.Receipt("msg_abc123")).when(sender).send(any());

        worker.deliverDue();

        ArgumentCaptor<EmailSender.RenderedEmail> email =
                ArgumentCaptor.forClass(EmailSender.RenderedEmail.class);
        verify(sender).send(email.capture());
        assertThat(email.getValue().toEmail()).isEqualTo("current@example.test");
        assertThat(email.getValue().subject()).contains("MAX");
        var settled = deliveries.findByEventIdAndEmailType(eventId, "SUBSCRIPTION_ACTIVATED").orElseThrow();
        assertThat(settled.getStatus()).isEqualTo("SENT");
        assertThat(settled.getSentAt()).isNotNull();
        // The provider's receipt is persisted: which provider carried it and
        // the id it issued, the join key into the provider's own logs.
        assertThat(settled.getProvider()).isEqualTo("TESTPROVIDER");
        assertThat(settled.getProviderMessageId()).isEqualTo("msg_abc123");
        // Every send carries the delivery row id as its idempotency key, so a
        // retry after a lost response cannot deliver a second copy.
        assertThat(email.getValue().deliveryId()).isEqualTo(settled.getId().toString());
    }

    @Test
    void aRetryAfterAnAddressChangeGoesToTheNewAddress() {
        String eventId = enqueue("SUBSCRIPTION_ACTIVATED");
        String user = deliveries.findByEventIdAndEmailType(eventId, "SUBSCRIPTION_ACTIVATED")
                .orElseThrow().getRecipientUserId();

        // Attempt 1: SMTP down; the user's address is still A.
        when(recipients.resolve(user)).thenReturn(found(user, "old-a@example.test"));
        doThrow(new IllegalStateException("SMTP send failed: down")).when(sender).send(any());
        worker.deliverDue();

        var afterFailure = deliveries.findByEventIdAndEmailType(eventId, "SUBSCRIPTION_ACTIVATED").orElseThrow();
        assertThat(afterFailure.getStatus()).isEqualTo("FAILED_RETRYABLE");
        assertThat(afterFailure.getAttemptCount()).isEqualTo(1);
        assertThat(afterFailure.getNextAttemptAt()).isNotNull();

        // Inside the backoff window nothing retries — no hot loop.
        worker.deliverDue();
        assertThat(deliveries.findByEventIdAndEmailType(eventId, "SUBSCRIPTION_ACTIVATED")
                .orElseThrow().getAttemptCount()).isEqualTo(1);

        // The user changes their address to B; the backoff elapses; SMTP is back.
        when(recipients.resolve(user)).thenReturn(found(user, "new-b@example.test"));
        doReturn(new EmailSender.Receipt("msg_abc123")).when(sender).send(any());
        makeDue(eventId);
        worker.deliverDue();

        ArgumentCaptor<EmailSender.RenderedEmail> email =
                ArgumentCaptor.forClass(EmailSender.RenderedEmail.class);
        verify(sender, org.mockito.Mockito.atLeastOnce()).send(email.capture());
        assertThat(email.getValue().toEmail()).isEqualTo("new-b@example.test");
        assertThat(deliveries.findByEventIdAndEmailType(eventId, "SUBSCRIPTION_ACTIVATED")
                .orElseThrow().getStatus()).isEqualTo("SENT");
    }

    @Test
    void aMissingRecipientIsPermanentAndAnUnavailableLookupIsRetryable() {
        String gone = enqueue("ACCOUNT_CREATED");
        String flaky = enqueue("ACCOUNT_CREATED");
        String goneUser = deliveries.findByEventIdAndEmailType(gone, "ACCOUNT_CREATED")
                .orElseThrow().getRecipientUserId();
        String flakyUser = deliveries.findByEventIdAndEmailType(flaky, "ACCOUNT_CREATED")
                .orElseThrow().getRecipientUserId();
        when(recipients.resolve(goneUser)).thenReturn(RecipientDirectory.Resolution.missing());
        when(recipients.resolve(flakyUser)).thenReturn(RecipientDirectory.Resolution.unavailable());

        worker.deliverDue();

        assertThat(deliveries.findByEventIdAndEmailType(gone, "ACCOUNT_CREATED")
                .orElseThrow().getStatus()).isEqualTo("FAILED_PERMANENT");
        assertThat(deliveries.findByEventIdAndEmailType(flaky, "ACCOUNT_CREATED")
                .orElseThrow().getStatus()).isEqualTo("FAILED_RETRYABLE");
    }

    @Test
    void exhaustedRetriesBecomePermanentNeverInfinite() {
        String eventId = enqueue("ACCOUNT_CREATED");
        String user = deliveries.findByEventIdAndEmailType(eventId, "ACCOUNT_CREATED")
                .orElseThrow().getRecipientUserId();
        when(recipients.resolve(anyString())).thenReturn(found(user, "a@example.test"));
        doThrow(new IllegalStateException("SMTP send failed: forever")).when(sender).send(any());

        for (int attempt = 0; attempt < 7; attempt += 1) {
            makeDue(eventId);
            worker.deliverDue();
        }

        var terminal = deliveries.findByEventIdAndEmailType(eventId, "ACCOUNT_CREATED").orElseThrow();
        assertThat(terminal.getStatus()).isEqualTo("FAILED_PERMANENT");
        assertThat(terminal.getAttemptCount()).isEqualTo(6); // 5-rung ladder + terminal
        assertThat(terminal.getLastError()).contains("SMTP send failed");
    }
}
