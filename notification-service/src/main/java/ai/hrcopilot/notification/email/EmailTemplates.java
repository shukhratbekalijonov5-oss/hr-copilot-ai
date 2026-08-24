package ai.hrcopilot.notification.email;

import ai.hrcopilot.notification.domain.ChannelPolicy;
import java.util.Map;

/**
 * The three product email families — account created, subscription
 * activated, subscription expiring in three days — in en / ko / ru / uz.
 *
 * ## Safety rules
 *
 * Every {placeholder} value is HTML-escaped before it enters the HTML
 * body, and CR/LF-stripped before it enters ANY part (subject header
 * injection dies here). Templates contain no user-authored markup, no
 * links to user-controlled URLs, and no secrets. Design is deliberately
 * simple — the full brand redesign is the next phase.
 *
 * Locale fallback is `en`; an unknown template type has NO entry, and the
 * caller treats that as a permanent (not retryable) condition.
 */
public final class EmailTemplates {

    public record Rendered(String subject, String html, String text) {
    }

    private record Family(Map<String, Strings> byLocale) {
        Strings of(String locale) {
            return byLocale.getOrDefault(locale, byLocale.get("en"));
        }
    }

    private record Strings(String subject, String heading, String body, String footer) {
    }

    private static final Family ACCOUNT_CREATED = new Family(Map.of(
            "en", new Strings(
                    "Welcome to HR Copilot AI",
                    "Welcome, {name}!",
                    "Your HR Copilot AI account has been created. You can now sign in and start using the platform.",
                    "You are receiving this because an account was created with this email address."),
            "ko", new Strings(
                    "HR Copilot AI에 오신 것을 환영합니다",
                    "{name}님, 환영합니다!",
                    "HR Copilot AI 계정이 생성되었습니다. 이제 로그인하여 플랫폼을 사용하실 수 있습니다.",
                    "이 이메일 주소로 계정이 생성되어 발송된 메일입니다."),
            "ru", new Strings(
                    "Добро пожаловать в HR Copilot AI",
                    "Добро пожаловать, {name}!",
                    "Ваш аккаунт HR Copilot AI создан. Теперь вы можете войти и начать пользоваться платформой.",
                    "Вы получили это письмо, потому что на этот адрес был создан аккаунт."),
            "uz", new Strings(
                    "HR Copilot AI ga xush kelibsiz",
                    "Xush kelibsiz, {name}!",
                    "HR Copilot AI hisobingiz yaratildi. Endi tizimga kirib, platformadan foydalanishingiz mumkin.",
                    "Ushbu elektron pochta manzili bilan hisob yaratilgani uchun bu xatni oldingiz.")));

    private static final Family SUBSCRIPTION_ACTIVATED = new Family(Map.of(
            "en", new Strings(
                    "Your {plan} plan is active",
                    "{name}, your {plan} plan is now active",
                    "Your payment was confirmed and your {plan} subscription is active. Enjoy your premium features!",
                    "You are receiving this because a subscription was activated on your account."),
            "ko", new Strings(
                    "{plan} 플랜이 활성화되었습니다",
                    "{name}님, {plan} 플랜이 활성화되었습니다",
                    "결제가 확인되어 {plan} 구독이 활성화되었습니다. 프리미엄 기능을 이용해 보세요!",
                    "회원님의 계정에서 구독이 활성화되어 발송된 메일입니다."),
            "ru", new Strings(
                    "Ваш план {plan} активирован",
                    "{name}, ваш план {plan} активирован",
                    "Платёж подтверждён, подписка {plan} активна. Пользуйтесь премиум-функциями!",
                    "Вы получили это письмо, потому что на вашем аккаунте была активирована подписка."),
            "uz", new Strings(
                    "{plan} tarifingiz faollashtirildi",
                    "{name}, {plan} tarifingiz faollashtirildi",
                    "To'lovingiz tasdiqlandi va {plan} obunangiz faol. Premium imkoniyatlardan bahramand bo'ling!",
                    "Hisobingizda obuna faollashtirilgani uchun bu xatni oldingiz.")));

    private static final Family SUBSCRIPTION_EXPIRES = new Family(Map.of(
            "en", new Strings(
                    "Your {plan} plan expires in 3 days",
                    "{name}, your {plan} plan expires soon",
                    "Your {plan} subscription ends on {date}. Renew to keep your premium features without interruption.",
                    "You are receiving this because your subscription period is ending."),
            "ko", new Strings(
                    "{plan} 플랜이 3일 후 만료됩니다",
                    "{name}님, {plan} 플랜이 곧 만료됩니다",
                    "{plan} 구독이 {date}에 종료됩니다. 프리미엄 기능을 계속 이용하려면 갱신해 주세요.",
                    "구독 기간이 종료되어 가고 있어 발송된 메일입니다."),
            "ru", new Strings(
                    "Ваш план {plan} истекает через 3 дня",
                    "{name}, ваш план {plan} скоро истекает",
                    "Подписка {plan} заканчивается {date}. Продлите её, чтобы сохранить премиум-функции без перерыва.",
                    "Вы получили это письмо, потому что срок вашей подписки подходит к концу."),
            "uz", new Strings(
                    "{plan} tarifingiz 3 kundan so'ng tugaydi",
                    "{name}, {plan} tarifingiz tez orada tugaydi",
                    "{plan} obunangiz {date} sanasida tugaydi. Premium imkoniyatlarni uzluksiz saqlash uchun uni yangilang.",
                    "Obuna muddatingiz tugayotgani uchun bu xatni oldingiz.")));

    private static final Map<String, Family> FAMILIES = Map.of(
            ChannelPolicy.ACCOUNT_CREATED, ACCOUNT_CREATED,
            ChannelPolicy.SUBSCRIPTION_ACTIVATED, SUBSCRIPTION_ACTIVATED,
            ChannelPolicy.SUBSCRIPTION_EXPIRES_IN_3_DAYS, SUBSCRIPTION_EXPIRES);

    private EmailTemplates() {
    }

    /** True when a template family exists for this email type. */
    public static boolean supports(String emailType) {
        return FAMILIES.containsKey(emailType);
    }

    /**
     * Render one email. `values` are USER-CONTROLLED (name) or product data
     * (plan, date): every value is header-sanitized everywhere and
     * HTML-escaped in the HTML part.
     */
    public static Rendered render(String emailType, String locale, Map<String, String> values) {
        Family family = FAMILIES.get(emailType);
        if (family == null) {
            throw new IllegalArgumentException("No template family for " + emailType);
        }
        Strings strings = family.of(locale == null ? "en" : locale);

        String subject = substitute(strings.subject(), values, false);
        String heading = substitute(strings.heading(), values, true);
        String body = substitute(strings.body(), values, true);
        String footer = substitute(strings.footer(), values, true);

        String html = """
                <!doctype html>
                <html><body style="margin:0;padding:0;background:#f5f6f8;font-family:Arial,Helvetica,sans-serif;">
                <div style="max-width:560px;margin:0 auto;padding:32px 16px;">
                  <div style="background:#ffffff;border-radius:8px;padding:32px;border:1px solid #e3e5e8;">
                    <p style="margin:0 0 24px;font-size:15px;font-weight:bold;color:#1a1a2e;">HR Copilot AI</p>
                    <h1 style="margin:0 0 16px;font-size:20px;color:#1a1a2e;">%s</h1>
                    <p style="margin:0;font-size:14px;line-height:1.6;color:#3c3f46;">%s</p>
                  </div>
                  <p style="margin:16px 8px 0;font-size:11px;line-height:1.5;color:#8a8f98;">%s</p>
                </div>
                </body></html>
                """.formatted(heading, body, footer);

        String textHeading = substitute(strings.heading(), values, false);
        String textBody = substitute(strings.body(), values, false);
        String textFooter = substitute(strings.footer(), values, false);
        String text = "HR Copilot AI\n\n" + textHeading + "\n\n" + textBody + "\n\n--\n" + textFooter + "\n";

        return new Rendered(subject, html, text);
    }

    private static String substitute(String template, Map<String, String> values, boolean htmlEscape) {
        String result = template;
        for (Map.Entry<String, String> entry : values.entrySet()) {
            String value = sanitizeHeader(entry.getValue());
            if (htmlEscape) {
                value = htmlEscape(value);
            }
            result = result.replace("{" + entry.getKey() + "}", value);
        }
        return result;
    }

    /** CR/LF (and other control chars) can never reach any part or header. */
    private static String sanitizeHeader(String value) {
        if (value == null) {
            return "";
        }
        return value.replaceAll("[\\r\\n\\t\\u0000-\\u001f]", " ").trim();
    }

    private static String htmlEscape(String value) {
        return value
                .replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;")
                .replace("\"", "&quot;")
                .replace("'", "&#39;");
    }
}
