import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  THEME_BOOT_SCRIPT,
  THEME_CHANGE_EVENT,
  THEME_STORAGE_KEY,
  serverThemeSnapshot,
} from "@/lib/theme/theme";
import { ALL_DICTIONARIES } from "@/lib/i18n/dictionary";

const ROOT = process.cwd();

function read(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

function code(path: string): string {
  return read(path)
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("theme boot", () => {
  it("resolves a theme before paint, from storage then the system", () => {
    expect(THEME_BOOT_SCRIPT).toContain(THEME_STORAGE_KEY);
    expect(THEME_BOOT_SCRIPT).toContain("prefers-color-scheme: dark");
    expect(THEME_BOOT_SCRIPT).toContain("theme-dark");
    expect(THEME_BOOT_SCRIPT).toContain("theme-light");
    // An explicit choice must win over the system preference.
    expect(THEME_BOOT_SCRIPT.indexOf('s==="dark"')).toBeLessThan(
      THEME_BOOT_SCRIPT.indexOf("matchMedia"),
    );
    // Storage can throw in private mode; the page must still get a theme.
    expect(THEME_BOOT_SCRIPT).toContain("catch");
  });

  it("runs synchronously in the document head", () => {
    const layout = code("app/layout.tsx");
    expect(layout).toContain("THEME_BOOT_SCRIPT");
    expect(layout).toContain("<head>");
    // A deferred or lazily-loaded script would paint the wrong theme first,
    // so the check is scoped to the script element itself — `async` appears
    // legitimately on the layout function.
    const tag = layout.slice(layout.indexOf("<script"), layout.indexOf("/>", layout.indexOf("<script")));
    expect(tag).toContain("THEME_BOOT_SCRIPT");
    expect(tag).not.toMatch(/\bdefer\b|\basync\b|strategy=/);
    expect(layout.indexOf("<head>")).toBeLessThan(layout.indexOf("<body"));
  });

  it("never reports a theme from the server", () => {
    expect(serverThemeSnapshot()).toBeNull();
  });

  it("clears any previous theme class before setting one", () => {
    // Without the remove, a second run could leave both classes on <html>.
    expect(THEME_BOOT_SCRIPT).toContain(
      'classList.remove("theme-light","theme-dark")',
    );
    expect(THEME_BOOT_SCRIPT.indexOf("classList.remove")).toBeLessThan(
      THEME_BOOT_SCRIPT.indexOf("classList.add"),
    );
  });
});

describe("hydration", () => {
  // Comment-stripped: the block above <html> explains the mismatch and names
  // the very tokens these assertions forbid, so the raw file would fail on
  // its own documentation.
  const layout = code("app/layout.tsx");

  it("renders a server <html> class that cannot depend on the browser", () => {
    // Fonts and static classes only — nothing read from storage or a media
    // query, so every request produces the same markup.
    expect(layout).toContain(
      "className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}",
    );
    expect(layout).not.toMatch(/theme-(light|dark)/);
  });

  it("declares the expected mismatch on <html>, and only there", () => {
    expect(layout).toContain("suppressHydrationWarning");
    // Exactly one occurrence: a blanket application elsewhere would hide
    // real mismatches in the rest of the tree.
    expect(layout.match(/suppressHydrationWarning/g)).toHaveLength(1);
    const htmlTag = layout.slice(layout.indexOf("<html"), layout.indexOf(">", layout.indexOf("<html")));
    expect(htmlTag).toContain("suppressHydrationWarning");
    // Never on <body>, and never on a provider.
    const bodyTag = layout.slice(layout.indexOf("<body"), layout.indexOf(">", layout.indexOf("<body")));
    expect(bodyTag).not.toContain("suppressHydrationWarning");
  });

  it("keeps both font variables on the root element", () => {
    expect(layout).toContain("geistSans.variable");
    expect(layout).toContain("geistMono.variable");
  });

  it("reads no browser API during the server render", () => {
    const body = layout.slice(layout.indexOf("export default async function RootLayout"));
    expect(body).not.toMatch(/localStorage|matchMedia|window\./);
  });
});

describe("theme toggle", () => {
  const toggle = code("components/layout/ThemeToggle.tsx");

  it("reads the document rather than keeping its own copy", () => {
    expect(toggle).toContain("useSyncExternalStore");
    expect(toggle).toContain("subscribeToTheme");
    expect(toggle).toContain("currentTheme");
    expect(toggle).not.toContain("useState");
  });

  it("holds its space until the theme is known", () => {
    expect(toggle).toContain("theme === null");
    expect(toggle).toContain("size-9 shrink-0");
  });

  it("names the destination in words, not just an icon", () => {
    expect(toggle).toContain("aria-label");
    expect(toggle).toContain("d.theme.switchToDark");
    expect(toggle).toContain("d.theme.switchToLight");
    for (const { locale, dictionary } of ALL_DICTIONARIES) {
      expect(dictionary.theme.switchToDark, locale).toBeTruthy();
      expect(dictionary.theme.switchToLight, locale).toBeTruthy();
    }
  });

  it("reacts to a change made in another tab", () => {
    const source = code("lib/theme/theme.ts");
    expect(source).toContain('window.addEventListener("storage", onChange)');
    expect(source).toContain(THEME_CHANGE_EVENT);
  });

  it("is mounted in the header", () => {
    expect(code("components/layout/Header.tsx")).toContain("<ThemeToggle />");
  });
});

describe("theme tokens", () => {
  const css = read("app/globals.css");

  it("defines each palette exactly once", () => {
    // One `:root` light block and one `.theme-dark` block — a
    // `prefers-color-scheme` copy would be a second definition that drifts.
    expect(css.match(/\.theme-dark \{/g)).toHaveLength(1);
    expect(css).not.toContain("prefers-color-scheme: dark");
  });

  it("carries the blush light and navy dark identities", () => {
    expect(css).toContain("--page: #fff8fb;");
    expect(css).toContain("--page: #06101f;");
    expect(css).toContain("--surface: #0b1728;");
  });

  it("exposes the token names the design system is addressed by", () => {
    for (const token of [
      "--page",
      "--surface",
      "--surface-raised",
      "--border",
      "--text",
      "--text-muted",
      "--primary",
      "--primary-hover",
      "--accent-soft",
      "--success",
      "--warning",
      "--danger",
      "--grid-color",
      "--ai-glow",
    ]) {
      expect(css, token).toContain(`${token}:`);
    }
  });

  it("declares a colour scheme per theme so native controls follow", () => {
    expect(css).toContain("color-scheme: light;");
    expect(css).toContain("color-scheme: dark;");
  });

  it("keeps the grid decorative and out of the layout", () => {
    expect(css).toContain("body::before");
    expect(css).toContain("--grid-size");
    expect(css).toContain("pointer-events: none;");
    // Fixed, so it never scrolls with content or lengthens the page.
    expect(css).toMatch(/body::before \{[\s\S]*?position: fixed;/);
    expect(css).toMatch(/body::before \{[\s\S]*?mask-image:/);
  });

  it("still disables every animation under reduced motion", () => {
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain("transition-duration: 0.01ms !important;");
  });
});
