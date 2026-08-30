package ai.hrcopilot.notification.support;

import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;

/**
 * Shared integration harness: one real PostgreSQL (Testcontainers,
 * postgres:16-alpine — the image the dev stack already uses), Flyway
 * running the real migrations, the full Spring context under the `test`
 * profile.
 *
 * The container is a singleton across every test class: containers are the
 * expensive part, contexts are cached by Spring, and each class works in
 * its own userIds so isolation comes from data, not from re-provisioning.
 *
 * ## Running without a local Docker daemon
 *
 * Pass -Dtest.jdbc.url (plus -Dtest.jdbc.username / -Dtest.jdbc.password)
 * and NO container is started — the suite runs against that database
 * instead, Flyway and all. This exists so the suite stays runnable on a
 * machine whose Docker daemon is unavailable; Testcontainers remains the
 * default and needs no flags.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("test")
public abstract class IntegrationTestBase {

    private static final String EXTERNAL_URL = System.getProperty("test.jdbc.url");

    protected static final PostgreSQLContainer<?> POSTGRES =
            EXTERNAL_URL == null ? new PostgreSQLContainer<>("postgres:16-alpine") : null;

    static {
        if (POSTGRES != null) {
            POSTGRES.start();
        }
    }

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        if (POSTGRES == null) {
            registry.add("spring.datasource.url", () -> EXTERNAL_URL);
            registry.add("spring.datasource.username",
                    () -> System.getProperty("test.jdbc.username", "postgres"));
            registry.add("spring.datasource.password",
                    () -> System.getProperty("test.jdbc.password", "postgres"));
            return;
        }
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
    }

    public static final String INTERNAL_TOKEN = "test-internal-token";
    public static final String UNUSED = "unused";
}
