package ai.hrcopilot.payment.repository;

import ai.hrcopilot.payment.domain.entity.Subscription;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface SubscriptionRepository extends JpaRepository<Subscription, UUID> {
    Optional<Subscription> findByBillingAccountId(UUID billingAccountId);

    /**
     * Paid subscriptions whose current period ends inside (now, until] —
     * the read the Notification Service's expiry-reminder scheduler makes.
     * Billing truth stays HERE; the caller only learns who is due. Statuses
     * are the ones that still retain a paid plan at the boundary.
     */
    @Query("SELECT s, a.userId FROM Subscription s, CustomerBillingAccount a "
            + "WHERE a.id = s.billingAccountId "
            + "AND s.currentPeriodEnd > :now AND s.currentPeriodEnd <= :until "
            + "AND s.currentPlan <> 'FREE' "
            + "AND s.status IN ('ACTIVE', 'CANCEL_AT_PERIOD_END', 'PAST_DUE')")
    List<Object[]> findExpiringPaid(@Param("now") Instant now, @Param("until") Instant until);
}
