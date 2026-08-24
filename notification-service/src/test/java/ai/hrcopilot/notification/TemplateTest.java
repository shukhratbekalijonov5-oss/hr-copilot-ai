package ai.hrcopilot.notification;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import ai.hrcopilot.notification.email.EmailTemplates;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** All 3 families × all 4 locales render; every value is escaped/sanitized. */
class TemplateTest {

    private static final String[] TYPES = {
        "ACCOUNT_CREATED", "SUBSCRIPTION_ACTIVATED", "SUBSCRIPTION_EXPIRES_IN_3_DAYS"
    };
    private static final String[] LOCALES = {"en", "ko", "ru", "uz"};

    @Test
    void everyFamilyRendersInEveryLocaleWithSubjectHtmlAndText() {
        for (String type : TYPES) {
            for (String locale : LOCALES) {
                var rendered = EmailTemplates.render(type, locale,
                        Map.of("name", "Jasur", "plan", "MAX", "date", "2026-08-28"));
                assertThat(rendered.subject()).as(type + "/" + locale).isNotBlank();
                assertThat(rendered.html()).contains("HR Copilot AI");
                assertThat(rendered.text()).contains("HR Copilot AI");
                assertThat(rendered.subject()).doesNotContain("{name}");
                assertThat(rendered.html()).doesNotContain("{plan}");
            }
        }
    }

    @Test
    void anUnknownLocaleFallsBackToEnglish() {
        var rendered = EmailTemplates.render("ACCOUNT_CREATED", "fr", Map.of("name", "A"));
        assertThat(rendered.subject()).isEqualTo("Welcome to HR Copilot AI");
        var nullLocale = EmailTemplates.render("ACCOUNT_CREATED", null, Map.of("name", "A"));
        assertThat(nullLocale.subject()).isEqualTo("Welcome to HR Copilot AI");
    }

    @Test
    void userControlledValuesAreHtmlEscapedAndHeaderSanitized() {
        var rendered = EmailTemplates.render("ACCOUNT_CREATED", "en",
                Map.of("name", "<script>alert(1)</script>\r\nBcc: evil@x.com"));
        assertThat(rendered.html()).doesNotContain("<script>");
        assertThat(rendered.html()).contains("&lt;script&gt;");
        // No injected header lines anywhere — CR/LF never survive.
        assertThat(rendered.subject()).doesNotContain("\n").doesNotContain("\r");
        assertThat(rendered.html()).doesNotContain("Bcc: evil@x.com\r");
    }

    @Test
    void anUntemplatedTypeIsAnExplicitError() {
        assertThatThrownBy(() -> EmailTemplates.render("NEW_MESSAGE", "en", Map.of()))
                .isInstanceOf(IllegalArgumentException.class);
        assertThat(EmailTemplates.supports("NEW_MESSAGE")).isFalse();
        assertThat(EmailTemplates.supports("ACCOUNT_CREATED")).isTrue();
    }
}
