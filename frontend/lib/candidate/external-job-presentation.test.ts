import { describe, expect, it } from "vitest";
import en from "@/lib/i18n/dictionaries/en";
import ko from "@/lib/i18n/dictionaries/ko";
import ru from "@/lib/i18n/dictionaries/ru";
import uz from "@/lib/i18n/dictionaries/uz";
import { ALL_DICTIONARIES } from "@/lib/i18n/dictionary";
import { format } from "@/lib/i18n/format";
import {
  externalBandLabel,
  externalDescriptionParagraphs,
  externalEmploymentLabel,
  externalLocationSummary,
  externalPlaceLabel,
  externalProvenanceLines,
  externalReasonLabel,
  externalReasonLines,
  externalRemoteScope,
  externalSalaryDisplay,
  externalSeniorityLabel,
  externalStatusNotice,
  externalStatusTone,
  externalWorkModeLabel,
} from "@/lib/candidate/external-job-presentation";
import type { ExternalJobResult } from "@/lib/types";

/**
 * What a card is allowed to say.
 *
 * Most of these assert an ABSENCE — no "worldwide", no "$0", no raw enum, no
 * probability. Those are the claims a job board is tempted to make on an
 * employer's behalf, and they are the ones a candidate cannot check.
 */

const d = en;

function job(over: Partial<ExternalJobResult> = {}): ExternalJobResult {
  return {
    externalJobId: "job-1",
    title: "Backend Engineer",
    company: "Acme",
    companyWebsiteUrl: null,
    status: "ACTIVE",
    location: { countryCode: "US", region: null, city: "New York City" },
    additionalLocations: [],
    workMode: null,
    remoteCountriesAllowed: [],
    employmentType: null,
    seniorityLevel: null,
    salary: { min: null, max: null, currency: null, payPeriod: null },
    employerPostedAt: null,
    score: 72,
    band: "GOOD",
    textScore: 80,
    intentScore: 60,
    reasons: [],
    applyUrl: "https://jobs.example.org/1",
    saved: false,
    tracking: null,
    provenance: { primarySource: "GREENHOUSE", applyVia: "GREENHOUSE", sourceCount: 1 },
    ...over,
  };
}

describe("location", () => {
  it("reads a place the way the rest of the product does", () => {
    expect(
      externalPlaceLabel(
        { countryCode: "KR", region: null, city: "Seoul" },
        d,
      ),
    ).toBe("Seoul, South Korea");
  });

  it("falls back to the ISO code for a country with no translation", () => {
    // The catalogue is worldwide; the dictionary is not. A bare "IE" is
    // honest and readable — "undefined" is neither.
    expect(
      externalPlaceLabel({ countryCode: "IE", region: null, city: "Dublin" }, d),
    ).toBe("Dublin, IE");
  });

  it("says nothing when the employer said nothing", () => {
    expect(
      externalPlaceLabel({ countryCode: null, region: null, city: null }, d),
    ).toBeNull();
    expect(
      externalLocationSummary(
        job({ location: { countryCode: null, region: null, city: null } }),
        d,
      ).unknown,
    ).toBe(true);
  });

  it("shows every office a posting is open in", () => {
    // The real shape of the bug this prevents: a job whose primary column says
    // New York but which the employer will also fill in Toronto. The backend
    // already treats Toronto as eligible; a card that hides it tells a reader
    // in Canada the job is somewhere else.
    const summary = externalLocationSummary(
      job({
        additionalLocations: [
          { countryCode: "CA", region: null, city: "Toronto" },
          { countryCode: "GB", region: null, city: "London" },
        ],
      }),
      d,
    );
    expect(summary.primary).toBe("New York City, United States");
    expect(summary.additional).toEqual([
      "Toronto, Canada",
      "London, United Kingdom",
    ]);
    expect(summary.overflow).toBe(0);
  });

  it("counts the offices that do not fit", () => {
    const summary = externalLocationSummary(
      job({
        additionalLocations: [
          { countryCode: "CA", region: null, city: "Toronto" },
          { countryCode: "GB", region: null, city: "London" },
          { countryCode: "DE", region: null, city: "Berlin" },
          { countryCode: "SG", region: null, city: "Singapore" },
        ],
      }),
      d,
      2,
    );
    expect(summary.additional).toHaveLength(2);
    expect(summary.overflow).toBe(2);
  });

  it("does not print the head office twice", () => {
    const summary = externalLocationSummary(
      job({
        additionalLocations: [
          { countryCode: "US", region: null, city: "New York City" },
          { countryCode: "CA", region: null, city: "Toronto" },
        ],
      }),
      d,
    );
    expect(summary.additional).toEqual(["Toronto, Canada"]);
  });
});

describe("remote", () => {
  it("names the countries when the employer named them", () => {
    const scope = externalRemoteScope(
      job({ workMode: "REMOTE", remoteCountriesAllowed: ["US", "CA"] }),
      d,
    );
    expect(scope.kind).toBe("REMOTE_STATED");
    expect(scope.countries).toEqual(["United States", "Canada"]);
  });

  it("never turns an unstated remote job into a worldwide one", () => {
    const scope = externalRemoteScope(
      job({ workMode: "REMOTE", remoteCountriesAllowed: [] }),
      d,
    );
    expect(scope.kind).toBe("REMOTE_UNSTATED");
    expect(scope.countries).toEqual([]);
  });

  it("has no wording for worldwide in any language", () => {
    // The strongest form of the guarantee: the words do not exist in the
    // dictionaries, so no branch can reach them by accident.
    for (const { locale, dictionary } of ALL_DICTIONARIES) {
      const wording = JSON.stringify(dictionary.externalJobs).toLowerCase();
      for (const claim of [
        "worldwide",
        "anywhere",
        "전 세계",
        "по всему миру",
        "butun dunyo",
      ]) {
        expect(wording, `${locale} must not promise ${claim}`).not.toContain(
          claim,
        );
      }
    }
  });

  it("does not raise the question for an on-site job", () => {
    expect(externalRemoteScope(job({ workMode: "ONSITE" }), d).kind).toBe(
      "NOT_REMOTE",
    );
  });
});

describe("salary", () => {
  it("shows the employer's own range in the employer's own money", () => {
    const salary = externalSalaryDisplay(
      { min: 200_000, max: 310_000, currency: "USD", payPeriod: "YEARLY" },
      d,
    );
    expect(salary.unknown).toBe(false);
    expect(salary.original).toContain("200,000");
    expect(salary.original).toContain("310,000 USD");
  });

  it("keeps a Korean posting in KRW", () => {
    // Never converted for display. The backend compares across currencies and
    // reports a verdict; the number on the card stays the number the employer
    // wrote.
    const salary = externalSalaryDisplay(
      { min: 40_000_000, max: 55_000_000, currency: "KRW", payPeriod: "YEARLY" },
      d,
    );
    expect(salary.original).toContain("KRW");
    expect(salary.original).not.toContain("USD");
  });

  it("says a missing salary is missing", () => {
    const salary = externalSalaryDisplay(
      { min: null, max: null, currency: null, payPeriod: null },
      d,
    );
    expect(salary.unknown).toBe(true);
    expect(salary.original).toBeNull();
    // Not a zero, and not an empty money-shaped slot.
    expect(d.externalJobs.salaryUnknown).not.toContain("0");
  });

  it("refuses an amount with no currency", () => {
    const salary = externalSalaryDisplay(
      { min: 100_000, max: null, currency: null, payPeriod: null },
      d,
    );
    expect(salary.unknown).toBe(true);
  });

  it("handles a one-sided range", () => {
    const salary = externalSalaryDisplay(
      { min: null, max: 80_000, currency: "GBP", payPeriod: "YEARLY" },
      d,
    );
    expect(salary.original).toContain("80,000 GBP");
  });
});

describe("score and band", () => {
  it("uses the backend's band and never re-derives it", () => {
    expect(externalBandLabel("STRONG", d)).toBe("Strong match");
    expect(externalBandLabel("LOW", d)).toBe("Low match");
    // A band this build does not know renders nothing rather than a guess.
    expect(externalBandLabel(null, d)).toBeNull();
  });

  it("never words the score as a chance of being hired", () => {
    /*
     * The check is on what sits BESIDE the number — the label, the value and
     * the four band words — because that is what a reader takes the score to
     * mean when they do not read further. The note beneath it is exempt on
     * purpose: it is the one string whose job is to deny exactly these words.
     */
    for (const { locale, dictionary } of ALL_DICTIONARIES) {
      const beside = [
        dictionary.externalJobs.scoreLabel,
        dictionary.externalJobs.scoreValue,
        ...Object.values(dictionary.externalJobs.band),
      ]
        .join(" ")
        .toLowerCase();
      for (const claim of [
        "chance",
        "likelihood",
        "probability",
        "hired",
        "%",
        "가능성",
        "вероятн",
        "ehtimol",
      ]) {
        expect(beside, `${locale} must not promise ${claim}`).not.toContain(
          claim,
        );
      }
      // And every locale says outright, next to the number, what it is not.
      expect(dictionary.externalJobs.scoreNote.length).toBeGreaterThan(20);
    }
  });

  it("denies the probability reading in every language", () => {
    const denial: Record<string, string> = {
      en: "not a chance",
      ko: "합격 가능성이 아닙니다",
      ru: "не вероятность",
      uz: "ehtimoli emas",
    };
    for (const { locale, dictionary } of ALL_DICTIONARIES) {
      expect(
        dictionary.externalJobs.scoreNote.toLowerCase(),
        `${locale} must deny the probability reading`,
      ).toContain(denial[locale].toLowerCase());
    }
  });
});

describe("reasons", () => {
  it("localizes the codes external search invented", () => {
    expect(externalReasonLabel("TEXT_STRONG_MATCH", d)).toBe(
      "Strong match for what you searched",
    );
    expect(externalReasonLabel("TEXT_SEMANTIC_MATCH", d)).toBe(
      "Similar to what you searched for",
    );
    expect(externalReasonLabel("STALE_LISTING", d)).toBe(
      "Listing may need re-verification",
    );
  });

  it("reuses AI Job Match's wording for the shared verdicts", () => {
    // The same verdict must read the same way on both screens, or a reader has
    // to work out that two sentences mean one thing.
    for (const code of [
      "LOCATION_EXACT",
      "SALARY_MEETS_MINIMUM",
      "SALARY_BELOW_MINIMUM",
      "SALARY_UNKNOWN",
      "SALARY_NOT_COMPARABLE",
      "WORK_MODE_MATCH",
      "EMPLOYMENT_MISMATCH",
      "SENIORITY_ADJACENT",
    ]) {
      expect(externalReasonLabel(code, d)).toBe(
        (d.jobMatch.matchReason as unknown as Record<string, string>)[code],
      );
    }
  });

  it("drops a reason code it has never heard of", () => {
    // The whole safety property: the backend adds a code tomorrow, an older
    // frontend simply does not mention it, and nobody sees SALARY_FOO_BAR on a
    // job card.
    expect(externalReasonLabel("SALARY_FOO_BAR", d)).toBeNull();
    const lines = externalReasonLines(
      [
        { code: "SALARY_FOO_BAR", dimension: "salary", state: "MATCH" },
        { code: "LOCATION_EXACT", dimension: "location", state: "MATCH" },
      ],
      d,
    );
    expect(lines.map((line) => line.code)).toEqual(["LOCATION_EXACT"]);
  });

  it("keeps the backend's order and caps what it prints", () => {
    const lines = externalReasonLines(
      [
        { code: "TEXT_STRONG_MATCH", dimension: "text", state: "MATCH" },
        { code: "WORK_MODE_MISMATCH", dimension: "workMode", state: "MISMATCH" },
        { code: "SALARY_UNKNOWN", dimension: "salary", state: "UNKNOWN" },
        { code: "LOCATION_EXACT", dimension: "location", state: "MATCH" },
      ],
      d,
      3,
    );
    expect(lines).toHaveLength(3);
    expect(lines[0].code).toBe("TEXT_STRONG_MATCH");
  });

  it("draws an absence neutrally, never as a fault", () => {
    const [line] = externalReasonLines(
      [{ code: "SALARY_UNKNOWN", dimension: "salary", state: "UNKNOWN" }],
      d,
    );
    // The job did not fail a test; nobody set one.
    expect(line.tone).toBe("neutral");
  });

  it("takes its tone from the backend's state, not from the words", () => {
    const tones = externalReasonLines(
      [
        { code: "LOCATION_EXACT", dimension: "location", state: "MATCH" },
        { code: "WORK_MODE_MISMATCH", dimension: "workMode", state: "MISMATCH" },
        { code: "SENIORITY_ADJACENT", dimension: "seniority", state: "PARTIAL" },
      ],
      d,
    ).map((line) => line.tone);
    expect(tones).toEqual(["positive", "negative", "neutral"]);
  });

  it("localizes every reason code in all four languages", () => {
    const codes = [
      "TEXT_STRONG_MATCH",
      "TEXT_TITLE_MATCH",
      "TEXT_PARTIAL_MATCH",
      "TEXT_SEMANTIC_MATCH",
      "STALE_LISTING",
      "LOCATION_EXACT",
      "SALARY_UNKNOWN",
      "SALARY_BELOW_MINIMUM",
    ];
    for (const { locale, dictionary } of ALL_DICTIONARIES) {
      for (const code of codes) {
        const label = externalReasonLabel(code, dictionary);
        expect(label, `${locale} is missing ${code}`).toBeTruthy();
        // A translation that is still the enum name is not a translation.
        expect(label).not.toBe(code);
      }
    }
  });
});

describe("status", () => {
  it("says nothing about a normal listing", () => {
    expect(externalStatusNotice("ACTIVE", d)).toBeNull();
  });

  it("surfaces a stale listing without calling it old", () => {
    const notice = externalStatusNotice("STALE", d);
    expect(notice).toBe("Listing may need re-verification");
    // STALE is a fact about OUR crawl. No provider states when an employer
    // published a role, so nothing here may imply a posting date.
    for (const { locale, dictionary } of ALL_DICTIONARIES) {
      const wording = (
        dictionary.externalJobs.staleNotice + dictionary.externalJobs.staleHint
      ).toLowerCase();
      for (const claim of ["posted", "게시된 지", "опубликовано", "e’lon qilingan sana"]) {
        expect(wording, `${locale} must not imply ${claim}`).not.toContain(claim);
      }
    }
  });

  it("names each end-of-life state instead of collapsing them", () => {
    // Search never returns these; the SAVED list does, because a candidate
    // keeps a posting for weeks and the employer moves on. An employer ending
    // a role, a stated deadline passing, and every source going unreadable are
    // three different facts, and a reader may act on them differently — so
    // each gets its own word rather than one catch-all.
    expect(externalStatusNotice("CLOSED", d)).toBe(d.externalJobs.closedNotice);
    expect(externalStatusNotice("EXPIRED", d)).toBe(d.externalJobs.expiredNotice);
    expect(externalStatusNotice("UNAVAILABLE", d)).toBe(
      d.externalJobs.unavailableNotice,
    );

    const said = [
      d.externalJobs.closedNotice,
      d.externalJobs.expiredNotice,
      d.externalJobs.unavailableNotice,
    ];
    expect(new Set(said).size).toBe(said.length);
  });

  it("does not silently render a status this build does not know", () => {
    // A value from a newer backend. A defensive label beats a card that looks
    // open, and beats printing the raw enum key at a job seeker.
    expect(externalStatusNotice("SOMETHING_NEW", d)).toBe(
      d.externalJobs.unexpectedStatus,
    );
  });

  it("never renders an end-of-life listing as quietly as an open one", () => {
    // ACTIVE is silence. Everything else must carry a tone loud enough to be
    // noticed before somebody spends an evening on an application.
    expect(externalStatusTone("ACTIVE")).toBeNull();
    for (const status of ["CLOSED", "EXPIRED", "UNAVAILABLE"]) {
      expect(externalStatusTone(status)).toBe("critical");
    }
    // STALE is a caution, not a death notice: not re-observing a listing is
    // not the same as it being gone.
    expect(externalStatusTone("STALE")).toBe("warning");
  });

  it("labels every lifecycle value in every locale", () => {
    for (const { locale, dictionary } of ALL_DICTIONARIES) {
      for (const status of ["STALE", "CLOSED", "EXPIRED", "UNAVAILABLE"]) {
        const label = externalStatusNotice(status, dictionary);
        expect(label, `${locale} / ${status}`).toBeTruthy();
        // No raw enum key ever reaches a reader.
        expect(label, `${locale} / ${status}`).not.toContain(status);
      }
      expect(externalStatusNotice("ACTIVE", dictionary)).toBeNull();
    }
  });
});

describe("provenance", () => {
  const f = (template: string, values: Record<string, string | number>) =>
    format(template, values);

  it("names the source without ranking it", () => {
    const lines = externalProvenanceLines(
      { primarySource: "GREENHOUSE", applyVia: "GREENHOUSE", sourceCount: 1 },
      d,
      f,
    );
    expect(lines.source).toBe("Source: Greenhouse");
    // One fact, printed once: "Apply via" appears only when it differs.
    expect(lines.applyVia).toBeNull();
    expect(lines.corroboration).toBeNull();
  });

  it("says where the application goes when it differs", () => {
    const lines = externalProvenanceLines(
      {
        primarySource: "COMPANY_CAREERS",
        applyVia: "GREENHOUSE",
        sourceCount: 2,
      },
      d,
      f,
    );
    expect(lines.source).toBe("Source: Company careers");
    expect(lines.applyVia).toBe("Apply via: Greenhouse");
    expect(lines.corroboration).toBe("Listed by 2 sources");
  });

  it("never claims one provider is better than another", () => {
    for (const { locale, dictionary } of ALL_DICTIONARIES) {
      const wording = JSON.stringify(dictionary.externalJobs).toLowerCase();
      for (const claim of [
        "trusted",
        "trustworthy",
        "more reliable",
        "official partner",
        "신뢰도",
        "надёжнее",
        "ishonchliroq",
      ]) {
        expect(wording, `${locale} must not rank providers`).not.toContain(
          claim,
        );
      }
    }
  });

  it("falls back to a generic word for an unknown provider", () => {
    const lines = externalProvenanceLines(
      { primarySource: "EXTERNAL_BOARD_V2", applyVia: null, sourceCount: 1 },
      d,
      f,
    );
    // Not the enum name: a leaked identifier on a job card is a bug a reader
    // has to interpret.
    expect(lines.source).toBe("Source: External source");
  });
});

describe("enums", () => {
  it("reads from the same blocks the rest of the product uses", () => {
    expect(externalWorkModeLabel("REMOTE", d)).toBe(d.workMode.REMOTE);
    expect(externalEmploymentLabel("FULL_TIME", d)).toBe(
      d.employmentTypeValue.FULL_TIME,
    );
    expect(externalSeniorityLabel("SENIOR", d)).toBe(d.seniorityLevel.SENIOR);
  });

  it("says nothing for an unstated value", () => {
    expect(externalWorkModeLabel(null, d)).toBeNull();
    expect(externalEmploymentLabel(null, d)).toBeNull();
    expect(externalSeniorityLabel(null, d)).toBeNull();
  });

  it("has a translation in every locale", () => {
    for (const dictionary of [en, ko, ru, uz]) {
      expect(externalWorkModeLabel("HYBRID", dictionary)).toBeTruthy();
      expect(externalEmploymentLabel("CONTRACT", dictionary)).toBeTruthy();
      expect(externalSeniorityLabel("LEAD", dictionary)).toBeTruthy();
      expect(externalBandLabel("PARTIAL", dictionary)).toBeTruthy();
    }
  });
});

describe("description", () => {
  it("splits blank-line-separated paragraphs", () => {
    expect(
      externalDescriptionParagraphs("About us.\n\nWhat you will do.\n\n"),
    ).toEqual(["About us.", "What you will do."]);
  });

  it("keeps a single block whole", () => {
    expect(
      externalDescriptionParagraphs("Line one\nLine two"),
    ).toEqual(["Line one\nLine two"]);
  });

  it("keeps Korean text intact", () => {
    expect(
      externalDescriptionParagraphs("백엔드 서비스를 만듭니다.\n\n지원 자격"),
    ).toEqual(["백엔드 서비스를 만듭니다.", "지원 자격"]);
  });

  it("is nothing when there is nothing", () => {
    expect(externalDescriptionParagraphs(null)).toEqual([]);
    expect(externalDescriptionParagraphs("   ")).toEqual([]);
  });
});

describe("the four locales", () => {
  it("has no English left in the other three", () => {
    // Provider brand names stay in Latin script on purpose — Greenhouse is
    // called Greenhouse in Seoul too — so the check is on the sentences.
    const sentences = (dictionary: typeof en) => [
      dictionary.externalJobs.title,
      dictionary.externalJobs.description,
      dictionary.externalJobs.apply,
      dictionary.externalJobs.applyHint,
      dictionary.externalJobs.salaryUnknown,
      dictionary.externalJobs.staleNotice,
      dictionary.externalJobs.scoreNote,
      dictionary.externalJobs.degradedNotice,
      dictionary.externalJobs.usingPreferences,
      dictionary.externalJobs.remoteUnstated,
    ];
    for (const dictionary of [ko, ru, uz]) {
      const theirs = sentences(dictionary);
      sentences(en).forEach((english, index) => {
        expect(theirs[index]).not.toBe(english);
      });
    }
  });

  it("keeps the plural forms each language actually needs", () => {
    expect(Object.keys(ko.externalJobs.resultCount)).toEqual(["other"]);
    expect(Object.keys(ru.externalJobs.resultCount).sort()).toEqual([
      "few",
      "many",
      "one",
      "other",
    ]);
    expect(Object.keys(uz.externalJobs.resultCount).sort()).toEqual([
      "one",
      "other",
    ]);
  });
});
