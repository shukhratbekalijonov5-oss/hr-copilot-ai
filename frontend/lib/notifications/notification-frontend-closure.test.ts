import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "@/lib/api/http";
import {
  getNotifications,
  getUnreadNotificationCount,
  markAllNotificationsRead,
  markNotificationRead,
} from "@/lib/api/notifications.service";
import { parseNotification } from "@/lib/notifications/adapter";
import {
  mergeNotifications,
  unreadCountAfterIncoming,
} from "@/lib/notifications/state";
import {
  NOTIFICATIONS_UNAVAILABLE,
  NotificationRequestError,
  notificationErrorText,
  toNotificationRequestError,
} from "@/lib/notifications/errors";
import { notificationFailure } from "@/lib/notifications/route-errors";
import { ApiError } from "@/lib/api/errors";
import { ALL_DICTIONARIES } from "@/lib/i18n/dictionary";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/api/http", () => ({ apiFetch: vi.fn() }));

/**
 * Closure for the notification frontend after email preferences were removed
 * from the product.
 *
 * ## What this file is defending
 *
 * Email delivery is now decided entirely server-side — account created,
 * subscription activated, subscription expiring — and everything else is
 * in-app only. There is no user-facing toggle, so the frontend must contain
 * no preference screen, no preference route call and no preference action.
 * Deleting those files once is easy; the risk is somebody re-adding a
 * plausible-looking toggle later, so the absence is asserted, not assumed.
 *
 * ## And what must NOT have been broken by that removal
 *
 * The in-app notification surface is untouched product: bell, list, unread
 * badge, mark-read, mark-all-read and the realtime stream. Those go through
 * the NestJS BFF and its socket gateway; the Java notification service is
 * never a browser destination, whatever the backend migrates behind the BFF.
 */

const ROOT = process.cwd();

function source(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

/** Source with comments stripped, so prose can never satisfy an assertion. */
function code(path: string): string {
  return source(path)
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/**
 * Every first-party SHIPPED source file — the app's own code, never
 * node_modules and never a test. Tests are excluded because this file, and
 * others like it, must name the forbidden strings in order to forbid them;
 * including them would make every sweep below fail on its own assertions.
 */
function appSources(): string[] {
  const roots = ["app", "components", "lib"];
  const found: string[] = [];

  const walk = (dir: string) => {
    for (const entry of readdirSync(join(ROOT, dir))) {
      const relative = join(dir, entry);
      if (statSync(join(ROOT, relative)).isDirectory()) {
        walk(relative);
      } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
        found.push(relative);
      }
    }
  };

  for (const dir of roots) walk(dir);
  return found;
}

function notification(id: string, isRead = false, audience = "CANDIDATE") {
  return {
    id,
    type: "INTERVIEW_INVITATION",
    audience,
    isRead,
    createdAt: "2026-08-25T10:00:00.000Z",
  };
}

describe("settings after the preference removal", () => {
  it("renders the profile section and nothing else", () => {
    const workspace = code("components/settings/SettingsWorkspace.tsx");

    expect(workspace).toContain("AccountProfileCard");
    expect(workspace).toContain("user={user}");
    // The tab strip is gone with the second section, so no tab id survives.
    for (const id of [
      "profile",
      "notifications",
      "organization",
      "team",
      "integrations",
      "security",
      "language",
    ]) {
      expect(workspace, id).not.toContain(`id: "${id}"`);
    }
    expect(workspace).not.toContain("Tabs");
  });

  it("keeps /settings on the shared authenticated route for both sides", () => {
    const page = code("app/(settings)/settings/page.tsx");
    const layout = code("app/(settings)/settings/layout.tsx");

    expect(page).toContain("requireSession()");
    expect(page).toContain("SettingsWorkspace");
    expect(layout).toContain("AppShell");
    expect(layout).toContain("personalFromSession");
    expect(layout).toContain("activeOrganizationWorkspace");
  });

  it("has no email preference UI anywhere in the app", () => {
    for (const file of appSources()) {
      const text = code(file);
      expect(text, file).not.toMatch(/EMAIL_NOTIFICATION_KEYS|EmailNotificationKey/);
      expect(text, file).not.toMatch(/NotificationPreferencesCard/);
      expect(text, file).not.toMatch(/notificationPreferences|NotificationPreferences/);
    }
  });

  it("deleted the preference component, adapter, types and actions", () => {
    for (const path of [
      "components/settings/NotificationPreferencesCard.tsx",
      "lib/api/notification-preferences.service.ts",
      "lib/notification-preferences/types.ts",
      "lib/notification-preferences",
      "app/(settings)/settings/actions.ts",
    ]) {
      expect(existsSync(join(ROOT, path)), path).toBe(false);
    }
  });

  it("never calls the account notification-preferences route", () => {
    for (const file of appSources()) {
      expect(code(file), file).not.toContain("notification-preferences");
    }
  });

  it("exposes no preference method on the API surface", () => {
    const index = code("lib/api/index.ts");
    expect(index).not.toContain("getNotificationPreferences");
    expect(index).not.toContain("updateNotificationPreferences");
  });

  it("carries no preference copy in any of the four locales", () => {
    for (const { locale, dictionary } of ALL_DICTIONARIES) {
      const settings = dictionary.settings as Record<string, unknown>;
      expect(settings.notificationPreferences, locale).toBeUndefined();
      expect(settings.tabNotifications, locale).toBeUndefined();
      // The fixed policy is stated instead, and stated in every language.
      expect(settings.accountEmailNote, locale).toBeTruthy();
    }
  });

  it("states where account email goes without offering a control", () => {
    const workspace = code("components/settings/SettingsWorkspace.tsx");
    expect(workspace).toContain("accountEmailNote");
    // A note, not a switch: no checkbox, no toggle, no save handler.
    expect(workspace).not.toMatch(/type="checkbox"|role="switch"|onChange/);
  });
});

describe("notification BFF contract", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reads the list from the NestJS notifications route", async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce({
      data: [notification("n1")],
      meta: { total: 1, page: 1, limit: 12, totalPages: 1 },
    });

    const page = await getNotifications({ page: 1, limit: 12 });
    expect(page.notifications).toHaveLength(1);
    expect(apiFetch).toHaveBeenCalledWith("/notifications", {
      query: { page: 1, limit: 12, unreadOnly: undefined, type: undefined },
    });
  });

  it("reads the unread count and tolerates every field alias", async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce({ unread: 3 });
    await expect(getUnreadNotificationCount()).resolves.toBe(3);
    expect(apiFetch).toHaveBeenCalledWith("/notifications/unread-count");

    vi.mocked(apiFetch).mockResolvedValueOnce({ count: 5 });
    await expect(getUnreadNotificationCount()).resolves.toBe(5);
  });

  it("marks one read and marks all read on the documented verbs", async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce(notification("n1", true));
    await expect(markNotificationRead("n1")).resolves.toMatchObject({
      id: "n1",
      isRead: true,
    });
    expect(apiFetch).toHaveBeenCalledWith("/notifications/n1/read", {
      method: "PATCH",
    });

    vi.mocked(apiFetch).mockResolvedValueOnce({ updated: 4 });
    await expect(markAllNotificationsRead()).resolves.toEqual({ updated: 4 });
    expect(apiFetch).toHaveBeenCalledWith("/notifications/read-all", {
      method: "POST",
    });
  });

  it("routes every browser request through the app's own route handlers", () => {
    const bell = code("components/notifications/NotificationBell.tsx");
    for (const path of [
      "/api/notifications/unread-count",
      "/api/notifications?",
      "/api/notifications/read-all",
      "/api/notifications/stream",
    ]) {
      expect(bell, path).toContain(path);
    }
    // The browser never learns the API's own origin or the socket URL.
    expect(bell).not.toMatch(/https?:\/\//);
  });
});

describe("realtime and read state", () => {
  it("subscribes to the stream and accepts the gateway's payload shape", () => {
    const bell = code("components/notifications/NotificationBell.tsx");
    expect(bell).toContain("new EventSource");
    expect(bell).toContain('addEventListener("notification"');
    expect(bell).toContain("parseNotification");

    const stream = code("app/api/notifications/stream/route.ts");
    // The one place that names the gateway event, server-side.
    expect(stream).toContain('socket.on("notification:new"');
    expect(stream).toContain("getSessionToken");
  });

  it("rejects an unreadable realtime payload instead of rendering a blank row", () => {
    expect(parseNotification({ id: "n1" })).toBeNull();
    expect(parseNotification(null)).toBeNull();
    expect(parseNotification(notification("n1"))).toMatchObject({ id: "n1" });
  });

  it("does not duplicate a notification delivered twice", () => {
    const first = parseNotification(notification("n1"))!;
    const again = parseNotification(notification("n1"))!;

    const merged = mergeNotifications([first], [again]);
    expect(merged).toHaveLength(1);
    // ...and the badge does not double-count it either.
    expect(unreadCountAfterIncoming([first], again, 1)).toBe(1);
  });

  it("increments unread for a genuinely new event", () => {
    const existing = parseNotification(notification("n1"))!;
    const incoming = parseNotification(notification("n2"))!;
    expect(unreadCountAfterIncoming([existing], incoming, 1)).toBe(2);
  });

  it("shows each side only its own notifications", () => {
    const bell = code("components/notifications/NotificationBell.tsx");
    // Both the fetched page and the realtime event are filtered by audience.
    expect(bell).toContain("notification.audience === audience");
    expect(bell).toContain("notification.audience !== audience");

    const header = code("components/layout/Header.tsx");
    expect(header).toContain("NotificationBell");
    expect(header).toContain('"CANDIDATE"');
    expect(header).toContain('"HR"');
  });

  it("mounts the bell for both workspaces", () => {
    for (const layout of [
      "app/(app)/layout.tsx",
      "app/(candidate)/layout.tsx",
      "app/(settings)/settings/layout.tsx",
    ]) {
      const text = code(layout);
      expect(text, layout).toContain("AppShell");
      expect(text, layout).toContain("getUnreadNotificationCount");
    }
    expect(code("components/layout/AppShell.tsx")).toContain("initialUnreadCount");
  });
});

describe("delivery boundaries the frontend must not cross", () => {
  it("never addresses the Java notification service from the browser", () => {
    for (const file of appSources()) {
      const text = code(file);
      expect(text, file).not.toMatch(/notification-service|localhost:808\d/);
    }
  });

  it("contains no mail transport, provider or recipient snapshot", () => {
    for (const file of appSources()) {
      const text = code(file);
      expect(text, file).not.toMatch(
        /smtp|sendgrid|mailgun|postmark|nodemailer|mailpit|\bresend\b/i,
      );
      expect(text, file).not.toMatch(/recipientEmail|emailSnapshot/);
    }
  });

  it("keeps profile email editing on the account endpoint", () => {
    const card = code("components/account/AccountProfileCard.tsx");
    expect(card).toContain("updateAccountProfileAction");
    expect(card).toContain("email");

    const actions = code("lib/account/actions.ts");
    expect(actions).toContain("updateAccountProfile");
  });

  it("keeps the notification dropdown usable on a narrow viewport", () => {
    const bell = code("components/notifications/NotificationBell.tsx");
    // Full-width panel below `sm`, anchored popover above it.
    expect(bell).toContain("w-[calc(100vw-1.5rem)]");
    expect(bell).toContain("sm:absolute");
    expect(bell).toContain("overflow-y-auto");
  });
});

describe("the notification service outage the BFF now states", () => {
  const copy = {
    load: "load",
    unavailable: "unavailable",
    markRead: "markRead",
    markAll: "markAll",
  };

  it("forwards the code, and only the code, out of the route handler", () => {
    const failure = notificationFailure(
      new ApiError(
        "Notifications are not available right now.",
        503,
        "unavailable",
        {},
        NOTIFICATIONS_UNAVAILABLE,
      ),
      "Could not load notifications.",
    );

    expect(failure.status).toBe(503);
    expect(failure.body.code).toBe(NOTIFICATIONS_UNAVAILABLE);
    // No upstream status text, stack or URL rides along.
    expect(Object.keys(failure.body).sort()).toEqual(["code", "message"]);
  });

  it("omits code entirely when the API classified nothing", () => {
    const failure = notificationFailure(new Error("boom"), "fallback");
    expect(failure.status).toBe(500);
    expect(failure.body).toEqual({ message: "boom" });
  });

  it("reads the handler body back into a typed error", () => {
    const error = toNotificationRequestError(
      { message: "Notifications are not available right now.", code: NOTIFICATIONS_UNAVAILABLE },
      "Request failed.",
    );
    expect(error).toBeInstanceOf(NotificationRequestError);
    expect(error.code).toBe(NOTIFICATIONS_UNAVAILABLE);

    expect(toNotificationRequestError(null, "Request failed.").message).toBe(
      "Request failed.",
    );
    expect(toNotificationRequestError({ message: 1 }, "Request failed.").code).toBeNull();
  });

  it("shows localized copy for an outage and never the backend's English", () => {
    const outage = new NotificationRequestError(
      "Notifications are not available right now.",
      NOTIFICATIONS_UNAVAILABLE,
    );

    expect(notificationErrorText(outage, copy.load, copy)).toBe(copy.unavailable);
    expect(notificationErrorText(outage, copy.markAll, copy)).toBe(copy.unavailable);
    // Anything unclassified keeps the caller's own localized fallback.
    expect(notificationErrorText(new Error("boom"), copy.load, copy)).toBe(copy.load);
    expect(notificationErrorText("boom", copy.markRead, copy)).toBe(copy.markRead);
  });

  it("never renders a raw upstream message string in the bell", () => {
    const bell = code("components/notifications/NotificationBell.tsx");
    expect(bell).toContain("notificationErrorText");
    expect(bell).not.toContain("caught.message");
  });

  it("localizes the outage in all four languages", () => {
    for (const { locale, dictionary } of ALL_DICTIONARIES) {
      expect(dictionary.notifications.errors.unavailable, locale).toBeTruthy();
    }
  });

  it("degrades the initial badge to zero rather than breaking the shell", () => {
    for (const layout of [
      "app/(app)/layout.tsx",
      "app/(candidate)/layout.tsx",
      "app/(settings)/settings/layout.tsx",
    ]) {
      expect(code(layout), layout).toContain("catch(() => 0)");
    }
  });
});
