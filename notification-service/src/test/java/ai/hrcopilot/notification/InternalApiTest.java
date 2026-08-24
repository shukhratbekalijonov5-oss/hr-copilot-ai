package ai.hrcopilot.notification;

import static org.assertj.core.api.Assertions.assertThat;

import ai.hrcopilot.notification.service.NotificationIngestService;
import ai.hrcopilot.notification.support.IntegrationTestBase;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;

/**
 * The internal read/mark contract the BFF consumes: recipient anchoring,
 * workspace scoping, the 404 wall, and the service credential.
 */
class InternalApiTest extends IntegrationTestBase {

    @Autowired
    private TestRestTemplate http;

    @Autowired
    private NotificationIngestService ingest;

    private HttpHeaders authed() {
        HttpHeaders headers = new HttpHeaders();
        headers.set("X-Internal-Token", INTERNAL_TOKEN);
        headers.set("Content-Type", "application/json");
        return headers;
    }

    private void seed(String eventId, String type, String user, String org) {
        ingest.ingest(new NotificationIngestService.IngestRequest(
                eventId, type, user, org,
                org == null ? "CANDIDATE" : "HR",
                "{\"vacancyTitle\":\"Backend Engineer\",\"vacancyId\":\"v1\"}"));
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> list(String query) {
        ResponseEntity<Map> response = http.exchange(
                "/internal/notifications?" + query,
                HttpMethod.GET,
                new HttpEntity<>(authed()),
                Map.class);
        assertThat(response.getStatusCode().value()).isEqualTo(200);
        return response.getBody();
    }

    @Test
    void listsAreRecipientAnchoredAndWorkspaceScoped() {
        String alice = "alice-" + UUID.randomUUID();
        seed("e1-" + alice, "NEW_APPLICATION", alice, "org-a");
        seed("e2-" + alice, "NEW_APPLICATION", alice, "org-b");
        seed("e3-" + alice, "NEW_MESSAGE", alice, null); // personal

        // Workspace A: the personal row + org-a's row, never org-b's.
        Map<String, Object> inA = list("userId=" + alice + "&organizationId=org-a&page=1&limit=20");
        assertThat((List<?>) inA.get("data")).hasSize(2);
        // No workspace: personal rows only.
        Map<String, Object> personal = list("userId=" + alice + "&page=1&limit=20");
        assertThat((List<?>) personal.get("data")).hasSize(1);
        // A different user sees nothing of Alice's.
        Map<String, Object> other = list("userId=bob-" + UUID.randomUUID() + "&page=1&limit=20");
        assertThat((List<?>) other.get("data")).isEmpty();
    }

    @Test
    @SuppressWarnings("unchecked")
    void markReadIsOwnRowsOnlyAndCountsFollow() {
        String user = "reader-" + UUID.randomUUID();
        seed("er-" + user, "INTERVIEW_INVITATION", user, null);

        Map<String, Object> before = list("userId=" + user + "&page=1&limit=20");
        Map<String, Object> row = ((List<Map<String, Object>>) before.get("data")).get(0);
        String id = (String) row.get("id");

        // Someone else cannot mark it — 404, indistinguishable from absent.
        ResponseEntity<String> foreign = http.exchange(
                "/internal/notifications/" + id + "/read",
                HttpMethod.POST,
                new HttpEntity<>("{\"userId\":\"intruder\"}", authed()),
                String.class);
        assertThat(foreign.getStatusCode().value()).isEqualTo(404);

        ResponseEntity<Map> marked = http.exchange(
                "/internal/notifications/" + id + "/read",
                HttpMethod.POST,
                new HttpEntity<>("{\"userId\":\"" + user + "\"}", authed()),
                Map.class);
        assertThat(marked.getStatusCode().value()).isEqualTo(200);
        assertThat(marked.getBody().get("isRead")).isEqualTo(true);

        ResponseEntity<Map> unread = http.exchange(
                "/internal/notifications/unread-count?userId=" + user,
                HttpMethod.GET,
                new HttpEntity<>(authed()),
                Map.class);
        assertThat(((Number) unread.getBody().get("unread")).longValue()).isZero();
    }

    @Test
    @SuppressWarnings("unchecked")
    void markAllReadTouchesOnlyTheCallersRows() {
        String user = "bulk-" + UUID.randomUUID();
        String bystander = "bystander-" + UUID.randomUUID();
        seed("eb1-" + user, "NEW_MESSAGE", user, null);
        seed("eb2-" + user, "NEW_MESSAGE", user, null);
        seed("eb3-" + bystander, "NEW_MESSAGE", bystander, null);

        ResponseEntity<Map> response = http.exchange(
                "/internal/notifications/read-all",
                HttpMethod.POST,
                new HttpEntity<>("{\"userId\":\"" + user + "\"}", authed()),
                Map.class);
        assertThat(((Number) response.getBody().get("updated")).intValue()).isEqualTo(2);

        Map<String, Object> bystanderList = list("userId=" + bystander + "&unreadOnly=true&page=1&limit=20");
        assertThat((List<?>) bystanderList.get("data")).hasSize(1); // untouched
    }

    @Test
    void everySurfaceDemandsTheServiceCredential() {
        assertThat(http.getForEntity("/internal/notifications?userId=x", String.class)
                        .getStatusCode().value())
                .isEqualTo(401);
        assertThat(http.postForEntity(
                                "/internal/notifications/read-all",
                                new HttpEntity<>("{\"userId\":\"x\"}"),
                                String.class)
                        .getStatusCode().value())
                .isEqualTo(401);
    }

    @Test
    @SuppressWarnings("unchecked")
    void legacyImportIsIdempotent() {
        String user = "legacy-" + UUID.randomUUID();
        String body = "{\"rows\":[{\"eventId\":\"legacy:row-" + user + "\","
                + "\"recipientUserId\":\"" + user + "\",\"type\":\"NEW_MESSAGE\","
                + "\"audience\":\"CANDIDATE\",\"organizationId\":null,"
                + "\"readAt\":\"2026-08-20T10:00:00Z\",\"createdAt\":\"2026-08-19T10:00:00Z\","
                + "\"context\":{\"messagePreview\":\"hello\"}}]}";

        ResponseEntity<Map> first = http.exchange(
                "/internal/notifications/import",
                HttpMethod.POST, new HttpEntity<>(body, authed()), Map.class);
        ResponseEntity<Map> second = http.exchange(
                "/internal/notifications/import",
                HttpMethod.POST, new HttpEntity<>(body, authed()), Map.class);

        assertThat(((Number) first.getBody().get("imported")).intValue()).isEqualTo(1);
        assertThat(((Number) second.getBody().get("imported")).intValue()).isZero();
        assertThat(((Number) second.getBody().get("duplicates")).intValue()).isEqualTo(1);

        // Read state and creation time survived the import.
        Map<String, Object> rows = list("userId=" + user + "&page=1&limit=20");
        Map<String, Object> row = ((List<Map<String, Object>>) rows.get("data")).get(0);
        assertThat(row.get("isRead")).isEqualTo(true);
        assertThat((String) row.get("createdAt")).startsWith("2026-08-19");
    }
}
