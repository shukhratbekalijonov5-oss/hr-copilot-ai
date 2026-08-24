package ai.hrcopilot.payment.repository;

import ai.hrcopilot.payment.domain.entity.Payment;
import jakarta.persistence.LockModeType;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface PaymentRepository extends JpaRepository<Payment, UUID> {
    Optional<Payment> findByBillingAccountIdAndIdempotencyKey(UUID billingAccountId, String idempotencyKey);

    Optional<Payment> findByProviderAndProviderCheckoutId(String provider, String providerCheckoutId);

    Optional<Payment> findByProviderAndProviderPaymentId(String provider, String providerPaymentId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT p FROM Payment p WHERE p.provider = :provider AND p.providerCheckoutId = :providerCheckoutId")
    Optional<Payment> lockByProviderAndProviderCheckoutId(
            @Param("provider") String provider,
            @Param("providerCheckoutId") String providerCheckoutId);

    long countByBillingAccountId(UUID billingAccountId);
}
