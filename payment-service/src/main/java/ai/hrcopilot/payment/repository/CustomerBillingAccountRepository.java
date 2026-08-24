package ai.hrcopilot.payment.repository;

import ai.hrcopilot.payment.domain.entity.CustomerBillingAccount;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface CustomerBillingAccountRepository extends JpaRepository<CustomerBillingAccount, UUID> {
    Optional<CustomerBillingAccount> findByUserId(String userId);
}
