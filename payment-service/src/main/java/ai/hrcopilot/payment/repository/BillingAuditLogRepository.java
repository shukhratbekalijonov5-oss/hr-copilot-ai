package ai.hrcopilot.payment.repository;

import ai.hrcopilot.payment.domain.entity.BillingAuditLog;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface BillingAuditLogRepository extends JpaRepository<BillingAuditLog, UUID> {
    List<BillingAuditLog> findByUserIdOrderByCreatedAtAsc(String userId);
}
