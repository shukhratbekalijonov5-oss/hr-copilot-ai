import { describe, expect, it } from "vitest";
import en from "@/lib/i18n/dictionaries/en";
import ko from "@/lib/i18n/dictionaries/ko";
import ru from "@/lib/i18n/dictionaries/ru";
import uz from "@/lib/i18n/dictionaries/uz";
import { ALL_DICTIONARIES } from "@/lib/i18n/dictionary";
import { format, formatDateFor, plural } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/locales";
import { postedAge, postedLabel } from "@/lib/candidate/posting-date";

/**
 * "Posted 3 days ago" — and every way of getting it wrong.
 *
 * The most important tests here are the ones about what CANNOT produce this
 * line. A crawler timestamp rendered as a posting date is invisible to the
 * reader and wrong for every job discovered later than it was published, which
 * is all of them.
 */

const NOW = new Date("2026-08-24T12:00:00Z").getTime();

const helpers = (locale: Locale, d: (typeof ALL_DICTIONARIES)[number]["dictionary"]) => ({
  p: (forms: Parameters<typeof plural>[0], count: number) =>
    plural(forms, count, locale),
  date: (value: string) => formatDateFor(value, d),
  f: format,
});

describe("how old a posting is", () => {
  it("counts today as today", () => {
    expect(postedAge("2026-08-24T09:00:00Z", NOW)).toEqual({ kind: "TODAY" });
  });

  it("counts yesterday as yesterday", () => {
    expect(postedAge("2026-08-23T23:00:00Z", NOW)).toEqual({
      kind: "YESTERDAY",
    });
  });

  it("counts calendar days, not elapsed hours", () => {
    // 25 hours before noon on the 24th is late on the 22nd — two calendar days
    // back, not one. Counting by elapsed time would call it "yesterday".
    expect(postedAge("2026-08-22T23:00:00Z", NOW)).toEqual({
      kind: "DAYS",
      days: 2,
    });
  });

  it("switches to a calendar date once the count stops being useful", () => {
    expect(postedAge("2026-08-18T12:00:00Z", NOW)).toEqual({
      kind: "DAYS",
      days: 6,
    });
    expect(postedAge("2026-08-17T12:00:00Z", NOW)).toEqual({ kind: "DATE" });
  });

  it("treats a slightly future date as today rather than refusing it", () => {
    // The backend already rejects anything beyond a two-day skew, so what
    // reaches here is a timezone edge. "Posted in 4 hours" would be worse.
    expect(postedAge("2026-08-24T20:00:00Z", NOW)).toEqual({ kind: "TODAY" });
  });

  it("says nothing when there is no date", () => {
    expect(postedAge(null, NOW)).toBeNull();
    expect(postedAge("", NOW)).toBeNull();
    expect(postedAge("not a date", NOW)).toBeNull();
  });
});

describe("the label a reader sees", () => {
  it("reads naturally in English", () => {
    const h = helpers("en", en);
    expect(postedLabel("2026-08-24T09:00:00Z", NOW, en, h)).toBe("Posted today");
    expect(postedLabel("2026-08-23T09:00:00Z", NOW, en, h)).toBe(
      "Posted yesterday",
    );
    expect(postedLabel("2026-08-21T09:00:00Z", NOW, en, h)).toBe(
      "Posted 3 days ago",
    );
    expect(postedLabel("2026-04-17T09:00:00Z", NOW, en, h)).toContain("2026");
  });

  it("reads naturally in Korean, with the verb where Korean puts it", () => {
    const h = helpers("ko", ko);
    expect(postedLabel("2026-08-24T09:00:00Z", NOW, ko, h)).toBe("오늘 게시");
    expect(postedLabel("2026-08-23T09:00:00Z", NOW, ko, h)).toBe("어제 게시");
    expect(postedLabel("2026-08-21T09:00:00Z", NOW, ko, h)).toBe("3일 전 게시");
  });

  it("inflects the Russian noun with the number", () => {
    // 1 день / 3 дня / 5 дней — the reason this goes through the plural
    // infrastructure instead of a template with a number dropped into it.
    const h = helpers("ru", ru);
    expect(postedLabel("2026-08-23T09:00:00Z", NOW, ru, h)).toBe(
      "Опубликовано вчера",
    );
    expect(postedLabel("2026-08-21T09:00:00Z", NOW, ru, h)).toBe(
      "Опубликовано 3 дня назад",
    );
    expect(postedLabel("2026-08-19T09:00:00Z", NOW, ru, h)).toBe(
      "Опубликовано 5 дней назад",
    );
  });

  it("reads naturally in Uzbek", () => {
    const h = helpers("uz", uz);
    expect(postedLabel("2026-08-24T09:00:00Z", NOW, uz, h)).toBe(
      "Bugun joylangan",
    );
    expect(postedLabel("2026-08-21T09:00:00Z", NOW, uz, h)).toBe(
      "3 kun oldin joylangan",
    );
  });

  it("says nothing at all when the employer stated no date", () => {
    for (const { locale, dictionary } of ALL_DICTIONARIES) {
      expect(
        postedLabel(null, NOW, dictionary, helpers(locale, dictionary)),
        `${locale} must render an unknown posting date as silence`,
      ).toBeNull();
    }
  });

  it("never invents a stand-in for an unknown date", () => {
    // No "Recently posted", no epoch, no "Unknown date". Half this catalogue
    // has no publication date and the honest rendering of that is nothing.
    for (const { locale, dictionary } of ALL_DICTIONARIES) {
      const wording = JSON.stringify(dictionary.externalJobs).toLowerCase();
      for (const invention of [
        "recently posted",
        "unknown date",
        "1970",
        "n/a",
        "최근 게시",
        "недавно опубликовано",
      ]) {
        expect(wording, `${locale} must not invent ${invention}`).not.toContain(
          invention,
        );
      }
    }
  });

  it("is a whole sentence in every language, not an English frame", () => {
    // Korean and Uzbek put the verb last; Russian inflects. A shared template
    // with a translated fragment would be wrong in three languages at once.
    const rendered = ALL_DICTIONARIES.map(({ locale, dictionary }) =>
      postedLabel(
        "2026-08-21T09:00:00Z",
        NOW,
        dictionary,
        helpers(locale, dictionary),
      ),
    );
    expect(new Set(rendered).size).toBe(ALL_DICTIONARIES.length);
    for (const line of rendered) expect(line).toBeTruthy();
  });
});

describe("what can never become a posting date", () => {
  it("is computed from the employer's date and nothing else", () => {
    /*
     * The function takes ONE date. There is no parameter it could read a
     * crawler timestamp from — `firstSeenAt`, `lastSeenAt`, `lastVerifiedAt`
     * and the row's `createdAt` are not in the search response at all, which
     * is what makes this structural rather than a matter of discipline.
     */
    expect(postedLabel.length).toBe(4);
    const employerDate = "2026-08-21T09:00:00Z";
    const crawlerDate = "2026-08-24T09:00:00Z";
    const h = helpers("en", en);
    expect(postedLabel(employerDate, NOW, en, h)).toBe("Posted 3 days ago");
    // Feeding the crawler date would say something different — which is the
    // whole reason it is not available to feed.
    expect(postedLabel(crawlerDate, NOW, en, h)).toBe("Posted today");
  });

  it("does not read the clock itself", () => {
    // The reference instant is a parameter, so the server render and the
    // browser hydration compute the same answer. Reading `Date.now()` inside
    // would let them disagree across midnight — a hydration mismatch.
    const early = postedAge("2026-08-21T09:00:00Z", NOW);
    const later = postedAge(
      "2026-08-21T09:00:00Z",
      NOW + 6 * 3600 * 1000,
    );
    expect(early).toEqual(later);
  });
});
