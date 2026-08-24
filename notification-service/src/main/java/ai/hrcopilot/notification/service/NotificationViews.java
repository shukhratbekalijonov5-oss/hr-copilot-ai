package ai.hrcopilot.notification.service;

import ai.hrcopilot.notification.domain.entity.Notification;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * The flat row view served to the backend BFF and echoed on
 * notifications.created.v1 — exactly the fields the frontend contract
 * renders, extracted from the stored context. Unknown context keys never
 * leave this service; a context that fails to parse degrades to nulls, not
 * to an error.
 */
public final class NotificationViews {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private NotificationViews() {
    }

    public static Map<String, Object> toView(Notification notification) {
        JsonNode context = parse(notification.getContextJson());
        Map<String, Object> view = new LinkedHashMap<>();
        view.put("id", notification.getId().toString());
        view.put("type", notification.getType());
        view.put("audience", notification.getAudience());
        view.put("organizationId", notification.getOrganizationId());
        view.put("isRead", notification.isRead());
        view.put("readAt", notification.getReadAt() == null ? null : notification.getReadAt().toString());
        view.put("createdAt", notification.getCreatedAt().toString());
        view.put("vacancyId", text(context, "vacancyId"));
        view.put("vacancyTitle", text(context, "vacancyTitle"));
        view.put("candidateId", text(context, "candidateId"));
        view.put("candidateName", text(context, "candidateName"));
        view.put("actorName", text(context, "actorName"));
        view.put("applicationId", text(context, "applicationId"));
        view.put("conversationId", text(context, "conversationId"));
        view.put("messageId", text(context, "messageId"));
        view.put("messagePreview", text(context, "messagePreview"));
        return view;
    }

    private static JsonNode parse(String contextJson) {
        try {
            return MAPPER.readTree(contextJson);
        } catch (Exception malformed) {
            return MAPPER.createObjectNode();
        }
    }

    private static String text(JsonNode context, String field) {
        JsonNode value = context.path(field);
        return value.isTextual() ? value.asText() : null;
    }
}
