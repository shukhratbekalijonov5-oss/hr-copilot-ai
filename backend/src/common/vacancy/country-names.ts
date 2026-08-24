import { ISO_COUNTRY_PATTERN } from './job-vocabulary';

/**
 * Country NAMES → ISO 3166-1 alpha-2, for text this product did not write.
 *
 * ## Why this exists, and why it is a dictionary
 *
 * Internal vacancies store country codes because a form made the recruiter
 * pick one. External sources hand over prose: a Greenhouse office reads
 * "London, England, United Kingdom", a Korean ATS will say "대한민국", an
 * aggregator will say "USA". Somewhere that has to become "GB", "KR", "US" or
 * honestly nothing at all.
 *
 * It is an explicit table rather than `Intl.DisplayNames` on purpose. `Intl`
 * output varies with the ICU version bundled in the runtime, so the same
 * posting could normalize to different countries on two machines — and a
 * silent locale-dependent change to what a candidate is eligible for is not a
 * bug anyone would find. A table is boring, greppable and identical
 * everywhere.
 *
 * ## The rules
 *
 *  1. EXACT match after folding (case, punctuation, spacing, diacritics).
 *     Never a prefix, never a substring, never a nearest neighbour. "Ind"
 *     resolves to nothing; it is not evidence for India or Indonesia.
 *  2. AMBIGUOUS names resolve to null. A name that names two places is not a
 *     location, and picking the more common one is a coin flip with a
 *     candidate's job search on it.
 *  3. Anything absent from the table is null, and null means "the source did
 *     not say a country" everywhere downstream. That is a safe value here:
 *     an unknown country never excludes a job, it only stops it earning a
 *     location point it did not prove.
 *
 * No model is consulted. Guessing a country wrong is worse than leaving it
 * unset — it can hide a job behind a location filter the candidate set, and
 * nobody would ever see why.
 */

/**
 * Folded form used for lookups: lowercase, diacritics removed, punctuation
 * and articles dropped. "Côte d'Ivoire", "Cote d Ivoire" and "COTE D'IVOIRE"
 * all land on the same key; "Ivory" still lands on nothing.
 */
export function foldCountryName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\bthe\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Canonical names and the aliases real sources actually write.
 *
 * Scope is deliberate rather than exhaustive: every country a posting has
 * plausibly named, with the spellings job boards use. A country missing from
 * here normalizes to null, which costs a ranking signal and breaks nothing —
 * the failure mode of adding a wrong alias is much worse than the failure mode
 * of omitting a right one.
 */
const COUNTRY_BY_NAME: Record<string, string> = {};

function define(code: string, ...names: string[]): void {
  for (const name of names) {
    const key = foldCountryName(name);
    if (!key) continue;
    // A name claimed by two countries is ambiguous by construction. Rather
    // than letting declaration order decide, both lose it — see rule 2.
    if (key in COUNTRY_BY_NAME && COUNTRY_BY_NAME[key] !== code) {
      COUNTRY_BY_NAME[key] = '';
      continue;
    }
    COUNTRY_BY_NAME[key] = code;
  }
}

// -- Asia-Pacific -----------------------------------------------------------
define(
  'KR',
  'South Korea',
  'Korea, South',
  'Republic of Korea',
  'Korea (South)',
  '대한민국',
  '한국',
  'ROK',
);
define('KP', 'North Korea', "Korea, Democratic People's Republic of");
define('JP', 'Japan', '日本', 'Nippon');
define('CN', 'China', "People's Republic of China", 'Mainland China', '中国');
define('TW', 'Taiwan', 'Chinese Taipei', 'Taiwan, Province of China');
define('HK', 'Hong Kong', 'Hong Kong SAR', 'Hong Kong SAR China');
define('MO', 'Macao', 'Macau');
define('SG', 'Singapore');
define('MY', 'Malaysia');
define('ID', 'Indonesia');
define('TH', 'Thailand');
define('VN', 'Vietnam', 'Viet Nam');
define('PH', 'Philippines');
define('IN', 'India');
define('PK', 'Pakistan');
define('BD', 'Bangladesh');
define('LK', 'Sri Lanka');
define('NP', 'Nepal');
define('MM', 'Myanmar', 'Burma');
define('KH', 'Cambodia');
define('LA', 'Laos', "Lao People's Democratic Republic");
define('MN', 'Mongolia');
define('AU', 'Australia');
define('NZ', 'New Zealand', 'Aotearoa');
define('FJ', 'Fiji');
define('PG', 'Papua New Guinea');

// -- Central Asia & Caucasus ------------------------------------------------
define('UZ', 'Uzbekistan', "O'zbekiston", 'Oʻzbekiston');
define('KZ', 'Kazakhstan');
define('KG', 'Kyrgyzstan', 'Kyrgyz Republic');
define('TJ', 'Tajikistan');
define('TM', 'Turkmenistan');
define('AZ', 'Azerbaijan');
define('AM', 'Armenia');
define('GE', 'Georgia');

// -- Europe -----------------------------------------------------------------
define(
  'GB',
  'United Kingdom',
  'UK',
  'Great Britain',
  'Britain',
  'United Kingdom of Great Britain and Northern Ireland',
);
define('IE', 'Ireland', 'Republic of Ireland');
define('FR', 'France');
define('DE', 'Germany', 'Deutschland');
define('ES', 'Spain', 'España');
define('PT', 'Portugal');
define('IT', 'Italy', 'Italia');
define('NL', 'Netherlands', 'The Netherlands', 'Holland');
define('BE', 'Belgium');
define('LU', 'Luxembourg');
define('CH', 'Switzerland');
define('AT', 'Austria');
define('DK', 'Denmark');
define('SE', 'Sweden', 'Sverige');
define('NO', 'Norway');
define('FI', 'Finland');
define('IS', 'Iceland');
define('EE', 'Estonia');
define('LV', 'Latvia');
define('LT', 'Lithuania');
define('PL', 'Poland', 'Polska');
define('CZ', 'Czechia', 'Czech Republic');
define('SK', 'Slovakia', 'Slovak Republic');
define('HU', 'Hungary');
define('RO', 'Romania');
define('BG', 'Bulgaria');
define('GR', 'Greece', 'Hellas');
define('HR', 'Croatia');
define('SI', 'Slovenia');
define('RS', 'Serbia');
define('BA', 'Bosnia and Herzegovina');
define('ME', 'Montenegro');
define('MK', 'North Macedonia', 'Macedonia');
define('AL', 'Albania');
define('MT', 'Malta');
define('CY', 'Cyprus');
define('UA', 'Ukraine');
define('BY', 'Belarus');
define('MD', 'Moldova', 'Republic of Moldova');
define('RU', 'Russia', 'Russian Federation');
define('TR', 'Turkey', 'Türkiye', 'Turkiye');

// -- Middle East & Africa ---------------------------------------------------
define('IL', 'Israel');
define('AE', 'United Arab Emirates', 'UAE');
define('SA', 'Saudi Arabia');
define('QA', 'Qatar');
define('KW', 'Kuwait');
define('BH', 'Bahrain');
define('OM', 'Oman');
define('JO', 'Jordan');
define('LB', 'Lebanon');
define('EG', 'Egypt');
define('MA', 'Morocco');
define('TN', 'Tunisia');
define('DZ', 'Algeria');
define('NG', 'Nigeria');
define('GH', 'Ghana');
define('KE', 'Kenya');
define('UG', 'Uganda');
define('TZ', 'Tanzania');
define('RW', 'Rwanda');
define('ET', 'Ethiopia');
define('ZA', 'South Africa');
define('ZM', 'Zambia');
define('ZW', 'Zimbabwe');
define('SN', 'Senegal');
define('CI', "Côte d'Ivoire", 'Cote d Ivoire', 'Ivory Coast');
define('CM', 'Cameroon');
define('MU', 'Mauritius');

// -- Americas ---------------------------------------------------------------
define(
  'US',
  'United States',
  'USA',
  'U.S.A.',
  'U.S.',
  'United States of America',
  'America',
);
define('CA', 'Canada');
define('MX', 'Mexico', 'México');
define('BR', 'Brazil', 'Brasil');
define('AR', 'Argentina');
define('CL', 'Chile');
define('CO', 'Colombia');
define('PE', 'Peru');
define('UY', 'Uruguay');
define('PY', 'Paraguay');
define('BO', 'Bolivia');
define('EC', 'Ecuador');
define('VE', 'Venezuela');
define('CR', 'Costa Rica');
define('PA', 'Panama');
define('GT', 'Guatemala');
define('DO', 'Dominican Republic');
define('PR', 'Puerto Rico');
define('JM', 'Jamaica');
define('TT', 'Trinidad and Tobago');

/**
 * ISO alpha-2 for a country name, or null.
 *
 * Also accepts an alpha-2 code directly, so a caller can hand over whatever a
 * source gave without first deciding which kind of value it is — but "US" is
 * only read as a code because it IS one, not because it looks short.
 */
export function countryCodeFromName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const upper = trimmed.toUpperCase();
  if (ISO_COUNTRY_PATTERN.test(upper) && upper !== 'UK') return upper;
  // "UK" is not an ISO code (the country is GB) but is written constantly, so
  // it is handled as the alias it is rather than passed through as a code.

  const code = COUNTRY_BY_NAME[foldCountryName(trimmed)];
  // '' marks a name two countries claim; see `define`.
  return code ? code : null;
}

export interface ParsedLocation {
  countryCode: string | null;
  region: string | null;
  city: string | null;
}

/**
 * A comma-separated place string → city / region / country.
 *
 * Job boards write locations as "City, Region, Country" ("London, England,
 * United Kingdom") or "City, Country" ("Berlin, Germany") or just a country
 * ("Singapore"). The country is identified by LOOKING IT UP, never by
 * position, because the trailing segment is only sometimes a country — so
 * "Remote - AMER" and "EMEA" yield no country rather than a country called
 * AMER.
 *
 * The city is deliberately not inferred from a lone segment: a single
 * unrecognized token could be a city, a region, a time zone or a marketing
 * phrase, and storing "EMEA" as a city would make it filterable as one.
 */
export function parseLocationString(value: unknown): ParsedLocation {
  const empty: ParsedLocation = {
    countryCode: null,
    region: null,
    city: null,
  };
  if (typeof value !== 'string') return empty;

  const parts = value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return empty;

  // Scan from the end: the country is the last segment that IS one.
  let countryIndex = -1;
  let countryCode: string | null = null;
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const code = countryCodeFromName(parts[i]);
    if (code) {
      countryCode = code;
      countryIndex = i;
      break;
    }
  }

  if (countryIndex < 0) {
    // No recognizable country. A single segment ("Singapore" would have been
    // caught above; "EMEA" was not) proves nothing about a city either.
    return empty;
  }

  const before = parts.slice(0, countryIndex);
  return {
    countryCode,
    // "London, England, United Kingdom" → region "England".
    region: before.length >= 2 ? before[before.length - 1] : null,
    city: before.length >= 1 ? before[0] : null,
  };
}
