package ai.hrcopilot.notification.repository;

import ai.hrcopilot.notification.domain.entity.Notification;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface NotificationRepository extends JpaRepository<Notification, UUID> {

    Optional<Notification> findByEventId(String eventId);

    /**
     * THE recipient scope, identical to the rule the old NestJS
     * implementation enforced: the caller's own rows only, with
     * organization-carrying (HR) rows further confined to the active
     * workspace; personal rows (organizationId null) always visible.
     */
    @Query("SELECT n FROM Notification n WHERE n.recipientUserId = :userId "
            + "AND (n.organizationId IS NULL OR n.organizationId = :organizationId) "
            + "AND (:unreadOnly = false OR n.readAt IS NULL) "
            + "AND (:type IS NULL OR n.type = :type) "
            + "ORDER BY n.createdAt DESC")
    List<Notification> pageForRecipient(
            @Param("userId") String userId,
            @Param("organizationId") String organizationId,
            @Param("unreadOnly") boolean unreadOnly,
            @Param("type") String type,
            Pageable pageable);

    @Query("SELECT COUNT(n) FROM Notification n WHERE n.recipientUserId = :userId "
            + "AND (n.organizationId IS NULL OR n.organizationId = :organizationId) "
            + "AND (:unreadOnly = false OR n.readAt IS NULL) "
            + "AND (:type IS NULL OR n.type = :type)")
    long countForRecipient(
            @Param("userId") String userId,
            @Param("organizationId") String organizationId,
            @Param("unreadOnly") boolean unreadOnly,
            @Param("type") String type);

    @Query("SELECT n FROM Notification n WHERE n.id = :id AND n.recipientUserId = :userId "
            + "AND (n.organizationId IS NULL OR n.organizationId = :organizationId)")
    Optional<Notification> findOwned(
            @Param("id") UUID id,
            @Param("userId") String userId,
            @Param("organizationId") String organizationId);

    @Query("SELECT n FROM Notification n WHERE n.recipientUserId = :userId "
            + "AND (n.organizationId IS NULL OR n.organizationId = :organizationId) "
            + "AND n.readAt IS NULL")
    List<Notification> findUnreadForRecipient(
            @Param("userId") String userId,
            @Param("organizationId") String organizationId);

    long countByReadAtIsNull();
}
