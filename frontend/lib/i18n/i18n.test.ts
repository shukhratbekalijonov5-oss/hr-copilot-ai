import { describe, expect, it } from "vitest";
import {
  DEFAULT_LOCALE,
  LOCALES,
  LOCALE_META,
  isLocale,
  matchAcceptLanguage,
  toLocale,
  type Locale,
} from "@/lib/i18n/locales";
import { ALL_DICTIONARIES, getDictionary } from "@/lib/i18n/dictionary";
import en from "@/lib/i18n/dictionaries/en";
import ko from "@/lib/i18n/dictionaries/ko";
import {
  format,
  formatDateFor,
  formatDateTimeFor,
  formatNumber,
  formatRelativeTimeFor,
  plural,
} from "@/lib/i18n/format";
import type { Plural } from "@/lib/i18n/dictionaries/en";

/* -------------------------------------------------------------------------- */
/* Locale mapping                                                              */
/* -------------------------------------------------------------------------- */

describe("supported locales", () => {
  it("matches the backend's SUPPORTED_LOCALES exactly", () => {
    // backend/src/ai/ai-service.client.ts. A locale the UI can select that the
    // API rejects would 400 every AI request made in it.
    expect([...LOCALES]).toEqual(["en", "ko", "ru", "uz"]);
  });

  it("resolves a dictionary for every locale", () => {
    for (const locale of LOCALES) {
      expect(getDictionary(locale)).toBeDefined();
    }
  });

  it("narrows unsupported input to the default rather than passing it on", () => {
    expect(isLocale("de")).toBe(false);
    expect(toLocale("de")).toBe(DEFAULT_LOCALE);
    expect(toLocale(undefined)).toBe(DEFAULT_LOCALE);
    expect(toLocale("ko")).toBe("ko");
  });

  it("names each language in itself", () => {
    expect(LOCALE_META.ko.label).toBe("한국어");
    expect(LOCALE_META.ru.label).toBe("Русский");
    expect(LOCALE_META.en.label).toBe("English");
  });

  it("picks a locale from Accept-Language, region subtags included", () => {
    expect(matchAcceptLanguage("ko-KR,ko;q=0.9,en;q=0.8")).toBe("ko");
    expect(matchAcceptLanguage("ru-RU,ru;q=0.9")).toBe("ru");
    expect(matchAcceptLanguage("uz;q=0.7,en;q=0.9")).toBe("en");
    expect(matchAcceptLanguage("de-DE,fr;q=0.8")).toBe(DEFAULT_LOCALE);
    expect(matchAcceptLanguage(null)).toBe(DEFAULT_LOCALE);
  });
});

/* -------------------------------------------------------------------------- */
/* Dictionary shape                                                            */
/* -------------------------------------------------------------------------- */

type Node = Record<string, unknown>;

function isPluralRecord(value: unknown): value is Plural {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as Plural).other === "string"
  );
}

/** Every leaf path in a dictionary, so two locales can be compared key-wise. */
function leafPaths(node: Node, prefix = ""): string[] {
  return Object.entries(node).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (Array.isArray(value)) return [path];
    if (isPluralRecord(value)) return [path];
    if (typeof value === "object" && value !== null) {
      return leafPaths(value as Node, path);
    }
    return [path];
  });
}

function leafAt(node: Node, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>((acc, key) => (acc as Node)?.[key], node);
}

/** Placeholder names a template expects, e.g. "{count} of {total}". */
function placeholders(value: unknown): Set<string> {
  const templates: string[] = isPluralRecord(value)
    ? Object.values(value).filter((form): form is string => typeof form === "string")
    : typeof value === "string"
      ? [value]
      : [];

  const names = new Set<string>();
  for (const template of templates) {
    for (const match of template.matchAll(/\{(\w+)\}/g)) names.add(match[1]);
  }
  return names;
}

const EN_PATHS = leafPaths(en as unknown as Node);

describe("dictionary completeness across all four locales", () => {
  it.each(ALL_DICTIONARIES.map(({ locale }) => locale))(
    "%s has exactly the same keys as English",
    (locale) => {
      const paths = leafPaths(getDictionary(locale) as unknown as Node);
      expect(new Set(paths)).toEqual(new Set(EN_PATHS));
    },
  );

  it.each(ALL_DICTIONARIES.map(({ locale }) => locale))(
    "%s has no empty or placeholder-only values",
    (locale) => {
      const dictionary = getDictionary(locale) as unknown as Node;
      // Digit separators are whitespace on purpose (Russian and Uzbek group
      // with a non-breaking space), so they are checked for presence only.
      const separators = new Set([
        "datetime.groupSeparator",
        "datetime.decimalSeparator",
      ]);
      const empty = EN_PATHS.filter((path) => {
        const value = leafAt(dictionary, path);
        if (separators.has(path)) return typeof value !== "string" || value === "";
        if (Array.isArray(value)) {
          return value.length === 0 || value.some((item) => !String(item).trim());
        }
        if (isPluralRecord(value)) return !value.other.trim();
        return typeof value !== "string" || !value.trim();
      });
      expect(empty).toEqual([]);
    },
  );

  it.each(ALL_DICTIONARIES.map(({ locale }) => locale))(
    "%s keeps every interpolation placeholder English declares",
    (locale) => {
      const dictionary = getDictionary(locale) as unknown as Node;
      const mismatched = EN_PATHS.filter((path) => {
        const expected = placeholders(leafAt(en as unknown as Node, path));
        const actual = placeholders(leafAt(dictionary, path));
        return [...expected].some((name) => !actual.has(name));
      });
      // A dropped placeholder means a number or name silently vanishes from the
      // sentence in that language.
      expect(mismatched).toEqual([]);
    },
  );

  it.each(ALL_DICTIONARIES.map(({ locale }) => locale))(
    "%s fills every plural category its own CLDR rules produce",
    (locale) => {
      const dictionary = getDictionary(locale) as unknown as Node;
      const rules = new Intl.PluralRules(LOCALE_META[locale].htmlLang);
      const counts = [0, 1, 2, 3, 5, 11, 21, 22, 25, 100];
      const needed = new Set(counts.map((count) => rules.select(count)));

      const incomplete: string[] = [];
      for (const path of EN_PATHS) {
        const value = leafAt(dictionary, path);
        if (!isPluralRecord(value)) continue;
        for (const category of needed) {
          if (category === "other") continue;
          if (!(category in value)) incomplete.push(`${path}:${category}`);
        }
      }
      // Russian needs one/few/many; Korean needs only `other`.
      expect(incomplete).toEqual([]);
    },
  );
});

/* -------------------------------------------------------------------------- */
/* Formatting                                                                  */
/* -------------------------------------------------------------------------- */

describe("format", () => {
  it("fills named placeholders", () => {
    expect(format("{count} of {total}", { count: 2, total: 9 })).toBe("2 of 9");
  });

  it("leaves an unknown placeholder visible rather than writing undefined", () => {
    expect(format("{count} of {total}", { count: 2 })).toBe("2 of {total}");
  });
});

describe("plural", () => {
  it("uses English one/other", () => {
    expect(plural(en.common.candidates, 1, "en")).toBe("1 candidate");
    expect(plural(en.common.candidates, 5, "en")).toBe("5 candidates");
  });

  it("uses Russian one/few/many", () => {
    const ru = getDictionary("ru");
    expect(plural(ru.common.candidates, 1, "ru")).toBe("1 кандидат");
    expect(plural(ru.common.candidates, 2, "ru")).toBe("2 кандидата");
    expect(plural(ru.common.candidates, 5, "ru")).toBe("5 кандидатов");
    expect(plural(ru.common.candidates, 21, "ru")).toBe("21 кандидат");
  });

  it("uses the single Korean form for every count", () => {
    expect(plural(ko.common.candidates, 1, "ko")).toBe("지원자 1명");
    expect(plural(ko.common.candidates, 7, "ko")).toBe("지원자 7명");
  });

  it("falls back to `other` when a locale does not define a category", () => {
    const forms: Plural = { other: "{count} items" };
    expect(plural(forms, 1, "en")).toBe("1 items");
  });
});

/* -------------------------------------------------------------------------- */
/* Korean terminology                                                          */
/* -------------------------------------------------------------------------- */

describe("Korean HR terminology", () => {
  it("uses the agreed core nouns rather than literal translations", () => {
    expect(ko.nav.vacancies).toBe("채용 공고");
    expect(ko.nav.candidates).toBe("지원자");
    expect(ko.nav.myApplications).toBe("지원 현황");
    expect(ko.status.documentType.RESUME).toBe("이력서");
    expect(ko.ai.questionsTitle).toBe("면접 질문");
  });

  it("uses the agreed evidence-status wording", () => {
    expect(ko.status.evidence.FOUND).toBe("근거 있음");
    expect(ko.status.evidence.NOT_FOUND).toBe("근거 없음");
    expect(ko.status.evidence.NEEDS_REVIEW).toBe("검토 필요");
  });

  it("uses the agreed pipeline-state wording", () => {
    expect(ko.status.job.RUNNING).toBe("처리 중");
    expect(ko.status.job.COMPLETED).toBe("완료");
    expect(ko.status.job.FAILED).toBe("실패");
  });

  it("states the 503 message without naming a provider", () => {
    expect(ko.ai.generationUnavailableHint).toContain("AI 생성");
    expect(ko.ai.generationUnavailableHint).toContain("근거 검색");
    for (const { dictionary } of ALL_DICTIONARIES) {
      // Provider branding is not part of this product's error copy.
      expect(dictionary.ai.generationUnavailableHint).not.toMatch(
        /gemini|openai|anthropic/i,
      );
    }
  });
});

describe("AI generation locale", () => {
  it("offers exactly the locales the AI endpoints accept", () => {
    const offered: Locale[] = [...LOCALES];
    expect(offered).toHaveLength(4);
    for (const locale of offered) {
      expect(LOCALE_META[locale].htmlLang).toBeTruthy();
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Date, time and number formatting                                            */
/*                                                                             */
/* These exist because Node and Chrome disagree in their ICU tables. A server   */
/* render that differs from the client hydration is a React hydration mismatch, */
/* which was observed to leave event handlers unattached. Every value below is  */
/* therefore built from the dictionary, not from the host's Intl data.          */
/* -------------------------------------------------------------------------- */

describe("formatDateFor", () => {
  const value = "2026-08-19T22:20:00.000Z";

  it("renders each locale in its own conventions", () => {
    expect(formatDateFor(value, getDictionary("en"))).toBe("Aug 19, 2026");
    expect(formatDateFor(value, getDictionary("ko"))).toBe("2026년 8월 19일");
    expect(formatDateFor(value, getDictionary("ru"))).toBe("19 авг. 2026 г.");
    expect(formatDateFor(value, getDictionary("uz"))).toBe("19-avg, 2026");
  });

  it("uses UTC so a server and a reader in different zones agree", () => {
    // 22:20Z is the next day in Asia/Seoul; the rendered date stays the 19th.
    expect(formatDateFor(value, en)).toBe("Aug 19, 2026");
  });

  it("never depends on host Intl data", () => {
    // Chrome renders "2026 M08 20" for uz via Intl; the dictionary does not.
    const uz = formatDateFor(value, getDictionary("uz"));
    expect(uz).not.toMatch(/M\d\d/);
  });

  it("returns the input unchanged rather than 'Invalid Date'", () => {
    expect(formatDateFor("not-a-date", en)).toBe("not-a-date");
  });
});

describe("formatDateTimeFor", () => {
  it("renders a 24-hour time with no AM/PM ambiguity", () => {
    const value = "2026-08-19T22:05:00.000Z";
    expect(formatDateTimeFor(value, en)).toBe("Aug 19, 22:05");
    expect(formatDateTimeFor(value, getDictionary("ko"))).toBe("8월 19일 22:05");
    expect(formatDateTimeFor(value, getDictionary("ru"))).toBe("19 авг., 22:05");
    expect(formatDateTimeFor(value, getDictionary("uz"))).toBe("19-avg, 22:05");
  });

  it("pads single-digit hours and minutes", () => {
    expect(formatDateTimeFor("2026-08-19T04:07:00.000Z", en)).toBe(
      "Aug 19, 04:07",
    );
  });
});

describe("formatRelativeTimeFor", () => {
  const now = Date.parse("2026-08-20T12:00:00.000Z");
  const ago = (ms: number) => new Date(now - ms).toISOString();

  it("uses each locale's own wording", () => {
    expect(formatRelativeTimeFor(ago(5 * 60_000), en, "en", now)).toBe(
      "5 minutes ago",
    );
    expect(
      formatRelativeTimeFor(ago(5 * 60_000), getDictionary("ko"), "ko", now),
    ).toBe("5분 전");
    expect(
      formatRelativeTimeFor(ago(5 * 60_000), getDictionary("uz"), "uz", now),
    ).toBe("5 daqiqa oldin");
  });

  it("applies Russian plural rules to relative time", () => {
    const ru = getDictionary("ru");
    expect(formatRelativeTimeFor(ago(1 * 60_000), ru, "ru", now)).toBe(
      "1 минуту назад",
    );
    expect(formatRelativeTimeFor(ago(3 * 60_000), ru, "ru", now)).toBe(
      "3 минуты назад",
    );
    expect(formatRelativeTimeFor(ago(7 * 60_000), ru, "ru", now)).toBe(
      "7 минут назад",
    );
  });

  it("steps up through minutes, hours and days", () => {
    expect(formatRelativeTimeFor(ago(30_000), en, "en", now)).toBe("just now");
    expect(formatRelativeTimeFor(ago(3 * 3_600_000), en, "en", now)).toBe(
      "3 hours ago",
    );
    expect(formatRelativeTimeFor(ago(3 * 86_400_000), en, "en", now)).toBe(
      "3 days ago",
    );
  });

  it("falls back to an absolute date beyond a month", () => {
    expect(formatRelativeTimeFor("2026-01-05T00:00:00.000Z", en, "en", now)).toBe(
      "Jan 5, 2026",
    );
  });

  it("never emits the browser's Uzbek fallback wording", () => {
    const uz = getDictionary("uz");
    expect(formatRelativeTimeFor(ago(5 * 60_000), uz, "uz", now)).not.toBe(
      "-5 min",
    );
  });
});

describe("formatNumber", () => {
  it("groups with each locale's own separators", () => {
    expect(formatNumber(12345.6, en)).toBe("12,345.6");
    expect(formatNumber(12345.6, getDictionary("ru"))).toBe("12\u00A0345,6");
    expect(formatNumber(12345.6, getDictionary("uz"))).toBe("12\u00A0345,6");
    expect(formatNumber(12345.6, getDictionary("ko"))).toBe("12,345.6");
  });

  it("handles small and negative values", () => {
    expect(formatNumber(0, en)).toBe("0");
    expect(formatNumber(999, en)).toBe("999");
    expect(formatNumber(-1234, en)).toBe("-1,234");
  });
});
