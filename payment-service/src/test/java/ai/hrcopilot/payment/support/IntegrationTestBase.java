package ai.hrcopilot.payment.support;

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
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("test")
public abstract class IntegrationTestBase {

    protected static final PostgreSQLContainer<?> POSTGRES =
            new PostgreSQLContainer<>("postgres:16-alpine");

    static {
        POSTGRES.start();
    }

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
    }

    public static final String INTERNAL_TOKEN = "test-internal-token";
    public static final String WEBHOOK_SECRET = "test-webhook-secret";
}
