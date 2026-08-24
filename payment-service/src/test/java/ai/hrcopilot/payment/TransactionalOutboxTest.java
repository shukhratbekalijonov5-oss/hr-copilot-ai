package ai.hrcopilot.payment;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import ai.hrcopilot.payment.domain.Plan;
import ai.hrcopilot.payment.repository.BillingAuditLogRepository;
import ai.hrcopilot.payment.repository.CustomerBillingAccountRepository;
import ai.hrcopilot.payment.repository.OutboxEventRepository;
import ai.hrcopilot.payment.service.PlanSwitchService;
import ai.hrcopilot.payment.support.IntegrationTestBase;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * The outbox guarantee: a billing transition and its event exist together
 * or not at all. No commit-then-hope, in either direction.
 */
class TransactionalOutboxTest extends IntegrationTestBase {

    @Autowired
    private PlanSwitchService planSwitch;

    @Autowired
    private TransactionTemplate transactions;

    @Autowired
    private CustomerBillingAccountRepository accounts;

    @Autowired
    private BillingAuditLogRepository audit;

    @Autowired
    private OutboxEventRepository outbox;

    @Test
    void aCommittedTransitionCommitsItsEventInTheSameTransaction() {
        String userId = "outbox-commit-" + UUID.randomUUID();
        long before = outbox.count();

        planSwitch.switchPlan(userId, Plan.MAX, "test");

        assertThat(accounts.findByUserId(userId)).isPresent();
        assertThat(outbox.count()).isEqualTo(before + 1);
        assertThat(audit.findByUserIdOrderByCreatedAtAsc(userId)).hasSize(1);
    }

    @Test
    void aFailedTransactionLeavesNeitherStateNorEventNorAudit() {
        String userId = "outbox-rollback-" + UUID.randomUUID();
        long outboxBefore = outbox.count();

        // The switch joins the surrounding transaction (REQUIRED); the
        // failure after it rolls EVERYTHING back — account, subscription,
        // audit row and outbox event are all part of one atomic unit.
        assertThatThrownBy(() -> transactions.executeWithoutResult(ignored -> {
            planSwitch.switchPlan(userId, Plan.MAX, "test");
            throw new IllegalStateException("simulated failure after the transition");
        })).isInstanceOf(IllegalStateException.class);

        assertThat(accounts.findByUserId(userId)).isEmpty();
        assertThat(audit.findByUserIdOrderByCreatedAtAsc(userId)).isEmpty();
        assertThat(outbox.count()).isEqualTo(outboxBefore);
    }
}
