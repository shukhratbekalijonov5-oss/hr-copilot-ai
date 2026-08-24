package ai.hrcopilot.payment.domain.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

/**
 * Append-only record of every billing-relevant transition: what changed,
 * for whom, caused by which actor (a webhook, the dev switch, an operator).
 * Written inside the transition's own transaction, so an audit row exists
 * exactly when the change it describes does.
 */
@Entity
@Table(name = "billing_audit_log")
public class BillingAuditLog {

    @Id
    private UUID id;

    @Column(name = "billing_account_id")
    private UUID billingAccountId;

    @Column(name = "user_id", nullable = false, length = 64)
    private String userId;

    @Column(name = "action", nullable = false, length = 64)
    private String action;

    @Column(name = "detail", nullable = false, columnDefinition = "text")
    private String detail;

    @Column(name = "actor", nullable = false, length = 64)
    private String actor;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    protected BillingAuditLog() {
    }

    public static BillingAuditLog entry(
            UUID billingAccountId, String userId, String action, String detail, String actor) {
        BillingAuditLog log = new BillingAuditLog();
        log.id = UUID.randomUUID();
        log.billingAccountId = billingAccountId;
        log.userId = userId;
        log.action = action;
        log.detail = detail;
        log.actor = actor;
        log.createdAt = Instant.now();
        return log;
    }

    public String getAction() {
        return action;
    }

    public String getDetail() {
        return detail;
    }

    public String getActor() {
        return actor;
    }
}
