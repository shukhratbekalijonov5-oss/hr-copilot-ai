package ai.hrcopilot.notification.repository;

import ai.hrcopilot.notification.domain.entity.OutboxEvent;
import jakarta.persistence.LockModeType;
import jakarta.persistence.QueryHint;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.jpa.repository.QueryHints;
import org.springframework.data.repository.query.Param;

public interface OutboxEventRepository extends JpaRepository<OutboxEvent, UUID> {

    /**
     * Pending events that are DUE (past their retry backoff), oldest first,
     * locked with SKIP LOCKED so two publisher instances partition the
     * backlog instead of double-publishing or blocking each other. A row
     * inside its backoff window is simply not selected: it cannot hot-loop,
     * and per-row marking means it does not block younger events either.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @QueryHints({@QueryHint(name = "jakarta.persistence.lock.timeout", value = "-2")})
    @Query("SELECT e FROM OutboxEvent e WHERE e.publishedAt IS NULL "
            + "AND (e.nextAttemptAt IS NULL OR e.nextAttemptAt <= :now) "
            + "ORDER BY e.createdAt ASC")
    List<OutboxEvent> lockPendingBatch(@Param("now") Instant now, Pageable pageable);

    long countByPublishedAtIsNull();

    /** Unpublished after many attempts — the stuck-event operator signal. */
    long countByPublishedAtIsNullAndAttemptCountGreaterThanEqual(int attempts);
}
