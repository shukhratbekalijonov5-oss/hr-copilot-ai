import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CONTACT,
  CONTACT_EMAIL_HREF,
  SOCIAL_LINKS,
  configuredSocialLinks,
} from "@/lib/config/contact";
import { ALL_DICTIONARIES } from "@/lib/i18n/dictionary";
import en from "@/lib/i18n/dictionaries/en";
import { CANDIDATE_TABS, RECRUITER_TABS } from "@/lib/workspace/primary-nav";

/**
 * The enlarged top bar, and the footer that appears on exactly two pages.
 *
 * The footer's whole risk is scope creep — a "home only" element that quietly
 * ends up on thirty screens, or a contact block that grows links to pages
 * nobody built. Most of what follows guards those two things.
 */

const ROOT = process.cwd();

function code(path: string): string {
  return readFileSync(join(ROOT, path), "utf8")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const header = code("components/layout/Header.tsx");
const topNav = code("components/layout/TopNav.tsx");
const footer = code("components/layout/AppHomeFooter.tsx");

/* -------------------------------------------------------------------------- */

describe("the enlarged top bar still is the top bar", () => {
  it("renders the candidate's five areas, unchanged", () => {
    expect(CANDIDATE_TABS.map((tab) => en.nav[tab.labelKey])).toEqual([
      "Home",
      "Career",
      "AI Search",
      "Chats",
      "More",
    ]);
    expect(header).toContain("<TopNav");
  });

  it("renders the recruiter's five areas, unchanged", () => {
    expect(RECRUITER_TABS.map((tab) => en.nav[tab.labelKey])).toEqual([
      "Home",
      "Hiring",
      "AI Search",
      "Chats",
      "More",
    ]);
  });

  it("grew to the 72px target without touching the phone's title bar", () => {
    expect(header).toContain("lg:h-[72px]");
    // Below `lg` this is still a 56px title bar; the bottom nav is unchanged.
    expect(header).toContain("h-14");
    expect(header).toContain("lg:hidden");
  });

  it("scales the brand, and keeps the role label subordinate to it", () => {
    // 36px mark, ~16.5px wordmark — both inside the brief's range.
    expect(header).toContain("size-9");
    expect(header).toContain("text-[16.5px]");
    // The role stays small and muted so it cannot compete with the name.
    expect(header).toContain("text-[11px] leading-tight text-ink-subtle");
  });

  it("puts the ambient glow on the logo and nowhere else in the chrome", () => {
    expect(header.match(/ai-halo/g)).toHaveLength(1);
  });

  it("gives nav items more type and more room, still without a filled pill", () => {
    expect(topNav).toContain("text-[14.5px]");
    expect(topNav).toContain("px-3");
    expect(topNav).toContain("xl:px-4");
    // Active = violet text + a 2px rule, never a saturated block.
    expect(topNav).toContain('selected ? "font-semibold text-brand-ink"');
    expect(topNav).toContain('h-[2px]');
    expect(topNav).not.toMatch(/selected && "bg-brand-soft"/);
  });

  it("keeps the right-side utilities compact", () => {
    // They stayed at the small control height while the bar grew around them.
    expect(header).toContain("h-9");
    for (const marker of ["openCommandPalette", "<LocaleSwitcher />", "<ThemeToggle />", "<NotificationBell"]) {
      expect(header, marker).toContain(marker);
    }
  });

  it("keeps transitions inside the 150-200ms band", () => {
    for (const source of [topNav, footer]) {
      expect(source).toContain("duration-[var(--motion-fast)]");
      expect(source).not.toMatch(/duration-\[(3|4|5|6|7|8|9)\d\dms\]/);
    }
  });
});

/* -------------------------------------------------------------------------- */

describe("the footer is on Home, and only on Home", () => {
  const HOME_PAGES = [
    "app/(candidate)/home/page.tsx",
    "app/(app)/dashboard/page.tsx",
  ];

  it.each(HOME_PAGES)("%s renders it", (page) => {
    expect(code(page)).toContain("<AppHomeFooter />");
  });

  it("is one shared component, not two copies", () => {
    for (const page of HOME_PAGES) {
      expect(code(page)).toContain(
        'import { AppHomeFooter } from "@/components/layout/AppHomeFooter"',
      );
    }
  });

  /*
   * Every other authenticated page. If the footer ever migrates into the
   * shell or gets pasted onto a work surface, this is what catches it.
   */
  const OTHER_PAGES = [
    "components/layout/AppShell.tsx",
    "app/(candidate)/jobs/page.tsx",
    "app/(candidate)/saved-jobs/page.tsx",
    "app/(candidate)/my-applications/page.tsx",
    "app/(candidate)/job-matches/page.tsx",
    "app/(candidate)/external-jobs/page.tsx",
    "app/(candidate)/my-profile/page.tsx",
    "app/(candidate)/job-preferences/page.tsx",
    "app/(candidate)/my-interview-chats/page.tsx",
    "app/(app)/candidates/page.tsx",
    "app/(app)/vacancies/page.tsx",
    "app/(app)/compare/page.tsx",
    "app/(app)/search/page.tsx",
    "app/(app)/interview-chats/page.tsx",
    "app/(settings)/plans/page.tsx",
    "app/(settings)/settings/page.tsx",
    "app/(settings)/layout.tsx",
    "app/(app)/layout.tsx",
    "app/(candidate)/layout.tsx",
  ];

  it.each(OTHER_PAGES)("%s does not", (page) => {
    expect(code(page)).not.toContain("AppHomeFooter");
  });

  it("clears the fixed mobile bar without adding a desktop gap", () => {
    // The shell already reserves the space; a second allowance here would
    // open a hole on desktop, where there is no bar to clear.
    expect(code("components/layout/AppShell.tsx")).toContain("pb-24");
    expect(footer).not.toContain("pb-24");
    expect(footer).not.toContain("fixed");
  });

  it("stacks down from three columns rather than scrolling sideways", () => {
    expect(footer).toContain("md:grid-cols-2");
    expect(footer).toContain("lg:grid-cols-");
    expect(footer).toContain("min-w-0");
  });
});

/* -------------------------------------------------------------------------- */

describe("contact links are real links", () => {
  it("dials the phone with a tel: URL, digits only", () => {
    expect(CONTACT.phoneHref).toBe("tel:01082110660");
    expect(CONTACT.phoneHref).toMatch(/^tel:\+?\d+$/);
    // The readable form keeps its separators; it is not what gets dialled.
    expect(CONTACT.phone).toBe("010-8211-0660");
    expect(footer).toContain("href={CONTACT.phoneHref}");
  });

  it("opens mail with a mailto: URL", () => {
    expect(CONTACT_EMAIL_HREF).toBe("mailto:shukhratbekalijonov4@gmail.com");
    expect(CONTACT_EMAIL_HREF.startsWith("mailto:")).toBe(true);
    expect(footer).toContain("href={CONTACT_EMAIL_HREF}");
  });

  it("labels both for a screen reader, and shows a focus ring", () => {
    expect(footer).toContain("d.footer.phoneLabel");
    expect(footer).toContain("d.footer.emailLabel");
    expect(footer.match(/focus-visible:ring-2/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("uses a semantic footer element", () => {
    expect(footer).toContain("<footer");
  });
});

/* -------------------------------------------------------------------------- */

describe("social links never point somewhere invented", () => {
  it("ships with every URL empty", () => {
    expect(Object.values(SOCIAL_LINKS).every((url) => url === "")).toBe(true);
  });

  it("renders nothing at all while they are empty", () => {
    expect(configuredSocialLinks()).toEqual([]);
    // Not a row of dead grey glyphs, and not a link to a network's homepage
    // dressed up as our profile.
    expect(footer).not.toMatch(/instagram\.com|t\.me|facebook\.com|x\.com|twitter\.com/);
    expect(footer).toContain("socials.length > 0");
  });

  it("needs only a URL in the config to start rendering one", () => {
    const filled = configuredSocialLinks({
      ...SOCIAL_LINKS,
      telegram: "https://t.me/example",
    });
    expect(filled).toHaveLength(1);
    expect(filled[0]).toMatchObject({ id: "telegram", label: "Telegram" });
    // Whitespace is not a URL.
    expect(configuredSocialLinks({ ...SOCIAL_LINKS, x: "   " })).toEqual([]);
  });

  it("opens an external profile safely, with a label", () => {
    expect(footer).toContain('target="_blank"');
    expect(footer).toContain('rel="noopener noreferrer"');
    expect(footer).toContain("aria-label={social.label}");
  });

  it("adds no icon dependency for four glyphs", () => {
    const icons = readFileSync(join(ROOT, "components/ui/icons.tsx"), "utf8");
    for (const name of ["InstagramIcon", "TelegramIcon", "FacebookIcon", "XIcon", "PhoneIcon"]) {
      expect(icons, name).toContain(`export const ${name}`);
    }
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    const deps = Object.keys(pkg.dependencies ?? {});
    expect(deps.filter((d) => /icon|lucide|heroicons|react-icons/i.test(d))).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */

describe("footer copy exists everywhere it is read", () => {
  it("has every string in all four locales", () => {
    for (const { locale, dictionary } of ALL_DICTIONARIES) {
      for (const key of [
        "tagline",
        "blurb",
        "contact",
        "phoneLabel",
        "emailLabel",
        "social",
        "rights",
      ] as const) {
        expect(dictionary.footer[key], `${locale}.footer.${key}`).toBeTruthy();
      }
    }
  });

  it("claims no Privacy or Terms page, because neither exists", () => {
    expect(footer).not.toMatch(/\/privacy|\/terms/);
    expect(en.footer.rights).toContain("2026");
  });
});
