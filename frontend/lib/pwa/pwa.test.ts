import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "@/app/manifest";
import {
  NEVER_CACHE_PREFIXES,
  PWA,
  isCacheableRequest,
} from "@/lib/pwa/config";
import {
  INSTALL_DISMISSED_KEY,
  isIosSafari,
  shouldOfferInstall,
} from "@/lib/pwa/install";
import { ALL_DICTIONARIES } from "@/lib/i18n/dictionary";
import { CANDIDATE_TABS, RECRUITER_TABS } from "@/lib/workspace/primary-nav";
import en from "@/lib/i18n/dictionaries/en";

/**
 * The PWA layer, and the responsive navigation it sits on.
 *
 * The rules worth testing here are the ones that fail SILENTLY in a browser:
 * a manifest behind auth (not installable, and nothing says why), a service
 * worker caching an authenticated response (an account leak on a shared
 * device), an install banner on first paint. None of those throw.
 */

const ROOT = process.cwd();

function code(path: string): string {
  return readFileSync(join(ROOT, path), "utf8")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/* -------------------------------------------------------------------------- */

describe("responsive navigation", () => {
  it("gives the candidate five mobile tabs", () => {
    expect(CANDIDATE_TABS.map((tab) => en.nav[tab.labelKey])).toEqual([
      "Home",
      "Career",
      "AI Search",
      "Chats",
      "More",
    ]);
  });

  it("gives the recruiter five mobile tabs", () => {
    expect(RECRUITER_TABS.map((tab) => en.nav[tab.labelKey])).toEqual([
      "Home",
      "Hiring",
      "AI Search",
      "Chats",
      "More",
    ]);
  });

  it("keeps the top bar desktop-only and the bottom bar mobile-only", () => {
    const top = code("components/layout/TopNav.tsx");
    expect(top).toContain("hidden");
    expect(top).toContain("lg:flex");

    const bottom = code("components/layout/BottomNav.tsx");
    expect(bottom).toContain("lg:hidden");
    expect(bottom).toContain("fixed inset-x-0 bottom-0");
  });

  it("has no desktop sidebar left anywhere", () => {
    for (const path of ["components/layout/Sidebar.tsx", "lib/ui/sidebar.ts"]) {
      expect(existsSync(join(ROOT, path))).toBe(false);
    }
    const shell = code("components/layout/AppShell.tsx");
    expect(shell).not.toContain("sidebar-rail");
    expect(shell).not.toContain("<Sidebar");
  });

  it("leaves room for the fixed bar and pays the safe-area inset once", () => {
    // The shell reserves the space so no screen has to remember to.
    expect(code("components/layout/AppShell.tsx")).toContain("pb-24");
    // The bar itself pays the inset — the only correct place for it.
    expect(code("components/layout/BottomNav.tsx")).toContain(
      "pb-[env(safe-area-inset-bottom)]",
    );
  });

  it("lets wide tables scroll inside their own container", () => {
    // A 640px table must never make the PAGE scroll sideways at 390px.
    for (const path of [
      "components/ui/DataTable.tsx",
      "components/compare/CompareWorkspace.tsx",
    ]) {
      const source = code(path);
      expect(source).toContain("min-w-[640px]");
      expect(source).toContain("overflow-x-auto");
    }
  });

  it("offers a card fallback below the table breakpoint", () => {
    for (const path of [
      "components/candidates/CandidateListView.tsx",
      "components/vacancies/VacancyListView.tsx",
    ]) {
      expect(code(path)).toContain("md:hidden");
    }
  });
});

/* -------------------------------------------------------------------------- */

describe("manifest", () => {
  const m = manifest();

  it("states every field an install needs", () => {
    expect(m.name).toBe("HR Copilot AI");
    expect(m.short_name).toBe("HR Copilot");
    expect(m.start_url).toBe("/");
    expect(m.display).toBe("standalone");
    expect(m.description).toBeTruthy();
  });

  it("keeps the home-screen label short enough for iOS", () => {
    // iOS truncates around 12 characters.
    expect((m.short_name ?? "").length).toBeLessThanOrEqual(12);
  });

  it("does not lock orientation", () => {
    /*
     * The brief allows it only if the product needs it, and it does not: the
     * recruiting tables and compare read better in landscape, and a tablet in
     * a stand is a normal way to run a hiring review.
     */
    expect(m.orientation).toBeUndefined();
  });

  it("declares 192 and 512 in both purposes, and the files exist", () => {
    const icons = m.icons ?? [];
    const any = icons.filter((icon) => icon.purpose === "any");
    const maskable = icons.filter((icon) => icon.purpose === "maskable");

    for (const set of [any, maskable]) {
      expect(set.map((icon) => icon.sizes).sort()).toEqual(["192x192", "512x512"]);
    }

    for (const icon of icons) {
      expect(icon.type).toBe("image/png");
      // A declared path that 404s is the most common broken-manifest bug.
      expect(existsSync(join(ROOT, "public", icon.src!)), icon.src).toBe(true);
    }
  });

  it("ships a PNG apple-touch-icon, because iOS ignores an SVG", () => {
    // An SVG here silently falls back to a screenshot of the page.
    expect(existsSync(join(ROOT, "public/icons/apple-touch-icon.png"))).toBe(true);
    expect(code("app/layout.tsx")).toContain("/icons/apple-touch-icon.png");
  });

  it("matches its colours to the app shell, not to the brand", () => {
    // The browser paints its bar with `theme_color`, directly against our
    // header — the brand blue there would read as a seam.
    expect(m.theme_color).toBe(PWA.themeColor);
    expect(m.background_color).toBe(PWA.backgroundColor);

    const css = readFileSync(join(ROOT, "app/globals.css"), "utf8");
    expect(css).toContain(`--canvas: ${PWA.backgroundColor};`);
    expect(css).toContain(`--surface: ${PWA.themeColorDark};`);
  });
});

/* -------------------------------------------------------------------------- */

describe("apple + viewport metadata", () => {
  const layout = code("app/layout.tsx");

  it("declares the app capable and titled for the home screen", () => {
    expect(layout).toContain("appleWebApp");
    expect(layout).toContain("capable: true");
    expect(layout).toContain("PWA.shortName");
  });

  it("keeps the status bar opaque rather than drawing under it", () => {
    /*
     * `black-translucent` puts the clock on top of our header on a notched
     * phone unless every screen pays for it.
     */
    expect(layout).toContain('statusBarStyle: "default"');
    expect(layout).not.toContain("black-translucent");
  });

  it("covers the safe area and never blocks pinch-zoom", () => {
    expect(layout).toContain('viewportFit: "cover"');
    // Blocking zoom is an accessibility failure, and buys nothing.
    expect(layout).not.toContain("maximumScale");
    expect(layout).not.toContain("userScalable");
  });

  it("gives the browser chrome a colour per scheme", () => {
    expect(layout).toContain("prefers-color-scheme: light");
    expect(layout).toContain("prefers-color-scheme: dark");
  });
});

/* -------------------------------------------------------------------------- */

describe("the service worker never caches anything sensitive", () => {
  const sw = readFileSync(join(ROOT, "public/sw.js"), "utf8");

  it("excludes every API, auth, settings and billing path", () => {
    for (const prefix of ["/api/", "/auth/", "/login", "/register", "/settings", "/plans"]) {
      expect(NEVER_CACHE_PREFIXES).toContain(prefix);
      expect(sw, prefix).toContain(prefix);
    }
  });

  it("refuses those paths by prefix, not by exact match", () => {
    // A cached /api/auth/me handed to the next person on a shared device is
    // an account leak; a cached candidate list is a confidentiality breach.
    expect(isCacheableRequest("/api/auth/me")).toBe(false);
    expect(isCacheableRequest("/api/candidates?page=2")).toBe(false);
    expect(isCacheableRequest("/settings/profile")).toBe(false);
    expect(isCacheableRequest("/plans")).toBe(false);

    // Static and ordinary pages stay cacheable.
    expect(isCacheableRequest("/_next/static/chunk.js")).toBe(true);
    expect(isCacheableRequest("/icons/icon-192.png")).toBe(true);
    expect(isCacheableRequest("/offline")).toBe(true);
  });

  it("caches only versioned build assets, and only on GET", () => {
    expect(sw).toContain('request.method !== "GET"');
    // Content-addressed paths are the only ones where a hit cannot be stale.
    expect(sw).toContain("/_next/static/");
    expect(sw).toContain("/icons/");
  });

  it("serves navigations network-first, so no page is ever stale", () => {
    expect(sw).toContain('request.mode === "navigate"');
    expect(sw).toContain("fetch(request).catch(");
    expect(sw).toContain("OFFLINE_URL");
  });

  it("ignores other origins entirely", () => {
    expect(sw).toContain("url.origin !== self.location.origin");
  });

  it("is not an offline-first app", () => {
    // No blanket precache of routes or API responses.
    expect(sw).not.toMatch(/addAll\(\[[^\]]*\/api/);
    expect(sw).not.toContain("staleWhileRevalidate");
  });
});

/* -------------------------------------------------------------------------- */

describe("PWA surfaces are reachable without a session", () => {
  const proxy = code("proxy.ts");

  it("lets the manifest and the offline page through", () => {
    /*
     * An install is evaluated by the browser, often before anyone signs in.
     * A manifest that 307s to /login fails every installability check — and
     * an offline page behind auth is unreachable exactly when it is needed.
     */
    expect(proxy).toContain("PUBLIC_ROUTES");
    expect(proxy).toContain('"/offline"');
    expect(proxy).toContain('"/manifest.webmanifest"');
  });

  it("excludes the service worker from the auth matcher", () => {
    // A worker is fetched with no cookies; a redirect makes registration
    // fail silently and the app is simply not installable.
    expect(proxy).toContain("sw\\\\.js");
  });

  it("still guards everything else", () => {
    expect(proxy).toContain("signedOut(request)");
    const publicList = proxy.slice(proxy.indexOf("const PUBLIC_ROUTES"));
    const line = publicList.slice(0, publicList.indexOf("];"));
    for (const guarded of ["/home", "/dashboard", "/candidates", "/api"]) {
      expect(line, guarded).not.toContain(`"${guarded}"`);
    }
  });
});

/* -------------------------------------------------------------------------- */

describe("install UX is offered, never pushed", () => {
  const base = { standalone: false, dismissed: false, promptAvailable: false, iosSafari: false };

  it("shows nothing on a cold first load", () => {
    // Neither signal exists yet: Chromium has not fired its event and the
    // reader is not on iOS. Nobody is interrupted before seeing the product.
    expect(shouldOfferInstall(base)).toBe("none");
  });

  it("offers the real prompt once the browser says it qualifies", () => {
    expect(shouldOfferInstall({ ...base, promptAvailable: true })).toBe("prompt");
  });

  it("falls back to Share-sheet guidance on iOS Safari only", () => {
    expect(shouldOfferInstall({ ...base, iosSafari: true })).toBe("ios-guidance");
  });

  it("never offers anything inside the installed app", () => {
    expect(
      shouldOfferInstall({ ...base, standalone: true, promptAvailable: true }),
    ).toBe("none");
    expect(shouldOfferInstall({ ...base, standalone: true, iosSafari: true })).toBe(
      "none",
    );
  });

  it("respects a dismissal", () => {
    expect(
      shouldOfferInstall({ ...base, dismissed: true, promptAvailable: true }),
    ).toBe("none");
    expect(INSTALL_DISMISSED_KEY).toBeTruthy();
  });

  it("tells an iPad from a desktop Safari", () => {
    const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit/605.1.15 Version/17.0 Safari/604.1";
    const ipad = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15";
    const mac = ipad;

    expect(isIosSafari(iphone)).toBe(true);
    // iPadOS reports itself as a Mac; touch points are what separate them.
    expect(isIosSafari(ipad, 5)).toBe(true);
    expect(isIosSafari(mac, 0)).toBe(false);
  });

  it("stays quiet in Chrome and Firefox on iOS, which cannot install", () => {
    const crios = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) CriOS/120 Mobile Safari/604.1";
    expect(isIosSafari(crios)).toBe(false);
  });

  it("never mistakes a touch-emulating desktop Chrome for an iPad", () => {
    /*
     * Found in the browser pass: DevTools touch emulation gives desktop
     * Chrome a Macintosh UA and 5 touch points, which matched the iPad
     * heuristic and offered a Share sheet that does not exist there.
     */
    const desktopChrome =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
    expect(isIosSafari(desktopChrome, 5)).toBe(false);
    expect(isIosSafari(desktopChrome, 0)).toBe(false);
  });

  it("suppresses the browser's own banner so ours can be localized", () => {
    const prompt = code("components/pwa/InstallPrompt.tsx");
    expect(prompt).toContain("event.preventDefault()");
    expect(prompt).toContain("appinstalled");
    // Mobile only: an install banner belongs where the app installs.
    expect(prompt).toContain("lg:hidden");
  });

  it("sits above the bottom bar rather than over it", () => {
    expect(code("components/pwa/InstallPrompt.tsx")).toContain(
      "bottom-[calc(4.5rem+env(safe-area-inset-bottom))]",
    );
  });
});

/* -------------------------------------------------------------------------- */

describe("offline state is honest", () => {
  const page = code("app/offline/page.tsx");

  it("claims nothing about the product's data", () => {
    expect(page).toContain("d.pwa.offlineTitle");
    expect(page).toContain("d.pwa.offlineHint");
    expect(en.pwa.offlineHint).toMatch(/nothing here updates/i);
  });

  it("makes no API call, because the network is what failed", () => {
    expect(page).not.toMatch(/api\.|fetch\(/);
  });

  it("registers the worker only in a secure context, and fails silently", () => {
    const registrar = code("components/pwa/ServiceWorkerRegistrar.tsx");
    expect(registrar).toContain("isSecureContext");
    expect(registrar).toContain(".catch(");
    // The app is fully functional without it; an error toast would report a
    // problem the reader cannot act on.
    expect(registrar).not.toContain("alert(");
  });
});

/* -------------------------------------------------------------------------- */

describe("every new string exists in all four locales", () => {
  it.each(ALL_DICTIONARIES.map((entry) => [entry.locale, entry.dictionary] as const))(
    "%s carries the PWA copy",
    (_locale, dictionary) => {
      for (const key of [
        "offlineTitle",
        "offlineHint",
        "offlineRetry",
        "installTitle",
        "installHint",
        "install",
        "installDismiss",
        "iosInstallTitle",
        "iosInstallHint",
      ] as const) {
        expect(dictionary.pwa[key]).toBeTruthy();
      }
    },
  );

  it("hard-codes no English in the PWA components", () => {
    for (const path of [
      "components/pwa/InstallPrompt.tsx",
      "app/offline/page.tsx",
    ]) {
      const text = code(path);
      const literals = [...text.matchAll(/>\s*([A-Z][a-z]+ [a-z][A-Za-z ]{3,})\s*</g)];
      expect(literals.map((match) => match[1]), path).toEqual([]);
    }
  });
});
