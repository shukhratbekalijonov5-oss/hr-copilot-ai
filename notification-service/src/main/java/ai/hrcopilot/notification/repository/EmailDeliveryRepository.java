package ai.hrcopilot.notification.repository;

import ai.hrcopilot.notification.domain.entity.EmailDelivery;
import jakarta.persistence.LockModeType;
import jakarta.persistence.QueryHint;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.jpa.repository.QueryHints;
import org.springframework.data.repository.query.Param;

public interface EmailDeliveryRepository extends JpaRepository<EmailDelivery, UUID> {

    Optional<EmailDelivery> findByEventIdAndEmailType(String eventId, String emailType);

    /**
     * Deliveries DUE for a send attempt, oldest first, locked with SKIP
     * LOCKED so multiple worker replicas partition the backlog — no email
     * can be picked up twice concurrently, no replica blocks another.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @QueryHints({@QueryHint(name = "jakarta.persistence.lock.timeout", value = "-2")})
    @Query("SELECT d FROM EmailDelivery d "
            + "WHERE d.status IN ('PENDING', 'FAILED_RETRYABLE') "
            + "AND (d.nextAttemptAt IS NULL OR d.nextAttemptAt <= :now) "
            + "ORDER BY d.createdAt ASC")
    List<EmailDelivery> lockDueBatch(@Param("now") Instant now, Pageable pageable);

    long countByStatusIn(List<String> statuses);
}
