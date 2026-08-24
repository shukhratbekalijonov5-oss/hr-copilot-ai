package ai.hrcopilot.payment.domain.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

/**
 * One billing identity per product user.
 *
 * Deliberately carries ONLY external references (userId, and optionally the
 * candidateAccountId) — no name, no email, no profile copy. The core
 * backend owns the person; this service owns their money, and duplicating
 * profile data here would create a second copy to keep consistent and a
 * second place personal data can leak from.
 */
@Entity
@Table(name = "customer_billing_accounts")
public class CustomerBillingAccount {

    @Id
    private UUID id;

    @Column(name = "user_id", nullable = false, unique = true, length = 64)
    private String userId;

    @Column(name = "candidate_account_id", length = 64)
    private String candidateAccountId;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    protected CustomerBillingAccount() {
    }

    public static CustomerBillingAccount create(String userId) {
        CustomerBillingAccount account = new CustomerBillingAccount();
        account.id = UUID.randomUUID();
        account.userId = userId;
        account.createdAt = Instant.now();
        account.updatedAt = account.createdAt;
        return account;
    }

    public UUID getId() {
        return id;
    }

    public String getUserId() {
        return userId;
    }

    public String getCandidateAccountId() {
        return candidateAccountId;
    }

    public void touch() {
        this.updatedAt = Instant.now();
    }
}
