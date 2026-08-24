package ai.hrcopilot.notification.domain;

import java.util.Map;
import java.util.Optional;

/**
 * THE channel routing table — the entire email policy of the product, in
 * one deterministic map.
 *
 * EMAIL IS SENT FOR EXACTLY THREE EVENTS:
 *
 *   ACCOUNT_CREATED                 → EMAIL (no in-app row: the person is
 *                                     looking at the product right now)
 *   SUBSCRIPTION_ACTIVATED          → EMAIL + IN_APP
 *   SUBSCRIPTION_EXPIRES_IN_3_DAYS  → EMAIL + IN_APP
 *
 * Every other event the product knows is IN-APP ONLY, and an event type
 * this deploy does NOT know is stored in-app defensively and NEVER emailed
 * — the safe default for a type added by a newer producer. There are no
 * user preference toggles anywhere; this table is the whole truth.
 */
public final class ChannelPolicy {

    public record Route(boolean inApp, boolean email) {
    }

    public static final String ACCOUNT_CREATED = "ACCOUNT_CREATED";
    public static final String SUBSCRIPTION_ACTIVATED = "SUBSCRIPTION_ACTIVATED";
    public static final String SUBSCRIPTION_EXPIRES_IN_3_DAYS = "SUBSCRIPTION_EXPIRES_IN_3_DAYS";

    private static final Map<String, Route> ROUTES = Map.ofEntries(
            // The three email events.
            Map.entry(ACCOUNT_CREATED, new Route(false, true)),
            Map.entry(SUBSCRIPTION_ACTIVATED, new Route(true, true)),
            Map.entry(SUBSCRIPTION_EXPIRES_IN_3_DAYS, new Route(true, true)),
            // Everything the product currently produces: in-app only.
            Map.entry("NEW_APPLICATION", new Route(true, false)),
            Map.entry("NEW_MESSAGE", new Route(true, false)),
            Map.entry("INTERVIEW_INVITATION", new Route(true, false)),
            Map.entry("VACANCY_DELETED", new Route(true, false)),
            Map.entry("APPLICATION_REJECTED", new Route(true, false)));

    private ChannelPolicy() {
    }

    /** The route for a KNOWN type; empty for anything unclassified. */
    public static Optional<Route> routeOf(String type) {
        return Optional.ofNullable(ROUTES.get(type));
    }

    /**
     * The effective route: known types as declared; unknown types are
     * persisted in-app (a newer producer's event must not vanish) and are
     * NEVER emailed.
     */
    public static Route effectiveRouteOf(String type) {
        return routeOf(type).orElse(new Route(true, false));
    }
}
