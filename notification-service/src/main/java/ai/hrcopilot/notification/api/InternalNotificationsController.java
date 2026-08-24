package ai.hrcopilot.notification.api;

import ai.hrcopilot.notification.domain.entity.Notification;
import ai.hrcopilot.notification.repository.NotificationRepository;
import ai.hrcopilot.notification.service.NotificationViews;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * The internal notification contract the NestJS BFF consumes — the READ and
 * MARK side of the authoritative store. Service-authenticated
 * (InternalAuthFilter); the BFF supplies the AUTHENTICATED caller's userId,
 * and every query is anchored on it: a cross-user or unknown id is a plain
 * 404, indistinguishable from non-existent. Organization scoping mirrors
 * the old backend rule exactly (personal rows always; HR rows confined to
 * the active workspace).
 */
@RestController
public class InternalNotificationsController {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final NotificationRepository notifications;

    public InternalNotificationsController(NotificationRepository notifications) {
        this.notifications = notifications;
    }

    @GetMapping("/internal/notifications")
    public Map<String, Object> list(
            @RequestParam("userId") String userId,
            @RequestParam(name = "organizationId", required = false) String organizationId,
            @RequestParam(name = "page", defaultValue = "1") int page,
            @RequestParam(name = "limit", defaultValue = "20") int limit,
            @RequestParam(name = "unreadOnly", defaultValue = "false") boolean unreadOnly,
            @RequestParam(name = "type", required = false) String type) {
        int boundedLimit = Math.max(1, Math.min(limit, 100));
        int boundedPage = Math.max(1, page);
        List<Map<String, Object>> data = notifications
                .pageForRecipient(userId, organizationId, unreadOnly, type,
                        PageRequest.of(boundedPage - 1, boundedLimit))
                .stream()
                .map(NotificationViews::toView)
                .toList();
        long total = notifications.countForRecipient(userId, organizationId, unreadOnly, type);
        return Map.of("data", data, "total", total);
    }

    @GetMapping("/internal/notifications/unread-count")
    public Map<String, Object> unreadCount(
            @RequestParam("userId") String userId,
            @RequestParam(name = "organizationId", required = false) String organizationId) {
        return Map.of("unread",
                notifications.countForRecipient(userId, organizationId, true, null));
    }

    public record MarkRequest(@NotBlank String userId, String organizationId) {
    }

    @PostMapping("/internal/notifications/{id}/read")
    @Transactional
    public ResponseEntity<Map<String, Object>> markRead(
            @PathVariable("id") String id, @Valid @RequestBody MarkRequest request) {
        UUID notificationId;
        try {
            notificationId = UUID.fromString(id);
        } catch (IllegalArgumentException notAUuid) {
            return ResponseEntity.notFound().build();
        }
        return notifications
                .findOwned(notificationId, request.userId(), request.organizationId())
                .map(notification -> {
                    notification.markRead();
                    notifications.save(notification);
                    return ResponseEntity.ok(NotificationViews.toView(notification));
                })
                .orElseGet(() -> ResponseEntity.notFound().build());
    }

    @PostMapping("/internal/notifications/read-all")
    @Transactional
    public Map<String, Object> markAllRead(@Valid @RequestBody MarkRequest request) {
        List<Notification> unread = notifications
                .findUnreadForRecipient(request.userId(), request.organizationId());
        unread.forEach(Notification::markRead);
        notifications.saveAll(unread);
        return Map.of("updated", unread.size());
    }

    /*
     * One-time legacy backfill from the backend's historical notification
     * table. Idempotent: each row's eventId hits the unique constraint on a
     * re-run and is counted as a duplicate, not an error. No created-echo
     * is emitted — these rows are history, not news.
     */

    public record ImportRow(
            @NotBlank String eventId,
            @NotBlank String recipientUserId,
            @NotBlank String type,
            @NotBlank String audience,
            String organizationId,
            String readAt,
            @NotBlank String createdAt,
            Map<String, Object> context) {
    }

    public record ImportRequest(@NotEmpty List<@Valid ImportRow> rows) {
    }

    @PostMapping("/internal/notifications/import")
    public Map<String, Object> importLegacy(@Valid @RequestBody ImportRequest request) {
        int imported = 0;
        int duplicates = 0;
        for (ImportRow row : request.rows()) {
            try {
                notifications.save(Notification.imported(
                        row.eventId(),
                        row.recipientUserId(),
                        row.organizationId(),
                        row.audience(),
                        row.type(),
                        MAPPER.valueToTree(row.context() == null ? Map.of() : row.context())
                                .toString(),
                        Instant.parse(row.createdAt()),
                        row.readAt() == null ? null : Instant.parse(row.readAt())));
                imported += 1;
            } catch (DataIntegrityViolationException alreadyImported) {
                duplicates += 1;
            }
        }
        return Map.of("imported", imported, "duplicates", duplicates,
                "status", HttpStatus.OK.value());
    }
}
