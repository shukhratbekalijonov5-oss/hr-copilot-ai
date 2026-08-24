package ai.hrcopilot.payment.domain.entity;

import ai.hrcopilot.payment.domain.Plan;
import ai.hrcopilot.payment.domain.SubscriptionStatus;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import java.time.Instant;
import java.util.UUID;

/**
 * One subscription per billing account (enforced by a unique index).
 *
 * `currentPlan`/`status` are stored as STRINGS and parsed defensively at
 * the domain boundary: a value written by a newer deployment must degrade
 * to "grants nothing" in an older one, never to an exception.
 *
 * `version` is both the optimistic lock and the entitlement version the
 * internal API publishes — every state transition increments it, so a
 * consumer can order entitlement snapshots without trusting clocks.
 */
@Entity
@Table(name = "subscriptions")
public class Subscription {

    @Id
    private UUID id;

    @Column(name = "billing_account_id", nullable = false)
    private UUID billingAccountId;

    @Column(name = "current_plan", nullable = false, length = 16)
    private String currentPlan;

    @Column(name = "pending_plan", length = 16)
    private String pendingPlan;

    @Column(name = "effective_at")
    private Instant effectiveAt;

    @Column(name = "status", nullable = false, length = 32)
    private String status;

    @Column(name = "current_period_start")
    private Instant currentPeriodStart;

    @Column(name = "current_period_end")
    private Instant currentPeriodEnd;

    @Column(name = "cancel_at_period_end", nullable = false)
    private boolean cancelAtPeriodEnd;

    @Version
    @Column(name = "version", nullable = false)
    private long version;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    protected Subscription() {
    }

    public static Subscription create(UUID billingAccountId, Plan plan, SubscriptionStatus status) {
        Subscription subscription = new Subscription();
        subscription.id = UUID.randomUUID();
        subscription.billingAccountId = billingAccountId;
        subscription.currentPlan = plan.name();
        subscription.status = status.name();
        subscription.createdAt = Instant.now();
        subscription.updatedAt = subscription.createdAt;
        return subscription;
    }

    public UUID getId() {
        return id;
    }

    public UUID getBillingAccountId() {
        return billingAccountId;
    }

    public String getCurrentPlanRaw() {
        return currentPlan;
    }

    public String getPendingPlanRaw() {
        return pendingPlan;
    }

    public Instant getEffectiveAt() {
        return effectiveAt;
    }

    public String getStatusRaw() {
        return status;
    }

    public Instant getCurrentPeriodStart() {
        return currentPeriodStart;
    }

    public Instant getCurrentPeriodEnd() {
        return currentPeriodEnd;
    }

    public boolean isCancelAtPeriodEnd() {
        return cancelAtPeriodEnd;
    }

    public long getVersion() {
        return version;
    }

    public void activate(Plan plan, Instant periodStart, Instant periodEnd) {
        this.currentPlan = plan.name();
        this.pendingPlan = null;
        this.effectiveAt = null;
        this.status = SubscriptionStatus.ACTIVE.name();
        this.currentPeriodStart = periodStart;
        this.currentPeriodEnd = periodEnd;
        this.cancelAtPeriodEnd = false;
        this.updatedAt = Instant.now();
    }

    public void schedulePlanChange(Plan target, Instant effectiveAt) {
        this.pendingPlan = target.name();
        this.effectiveAt = effectiveAt;
        this.updatedAt = Instant.now();
    }

    public void scheduleCancellation() {
        this.status = SubscriptionStatus.CANCEL_AT_PERIOD_END.name();
        this.cancelAtPeriodEnd = true;
        this.updatedAt = Instant.now();
    }

    /*
     * Renewal lifecycle transitions. Provider-independent by design: no
     * recurring Toss billing is implemented (and none is pretended), but
     * the DOMAIN must already know what a renewal outcome does so the
     * future billing job is a caller, not a redesign.
     */

    /**
     * Renewal success — a new paid period on the given plan (the caller
     * resolves a due pending downgrade into `plan`). Also the PAST_DUE
     * recovery transition.
     */
    public void renew(Plan plan, Instant periodStart, Instant periodEnd) {
        activate(plan, periodStart, periodEnd);
    }

    /** Renewal failure — dunning starts; entitlement grace is bounded. */
    public void markPastDue() {
        this.status = SubscriptionStatus.PAST_DUE.name();
        this.updatedAt = Instant.now();
    }

    /** Terminal renewal failure or run-out period — grants nothing after. */
    public void expire() {
        this.status = SubscriptionStatus.EXPIRED.name();
        this.pendingPlan = null;
        this.effectiveAt = null;
        this.cancelAtPeriodEnd = false;
        this.updatedAt = Instant.now();
    }
}
