/**
 * Korean street addresses → country, region, city.
 *
 * ## Why this is its own layer, and why it is a table
 *
 * `country-names.ts` answers "is this string a country". A Korean address is a
 * different problem: it never names its country at all. "부산 해운대구 센텀중앙로
 * 97" is unambiguously in Korea, but only because it *starts with a Korean
 * administrative region* — and that is a fact about the seventeen 시/도, not
 * something a general parser can infer.
 *
 * So this is an explicit prefix table, matched only at the START of an address,
 * and it is provider-neutral: any source may hand over a Korean address, and
 * Ninehire is simply the first that does.
 *
 * ## The rules
 *
 *  1. The FIRST token must be one of the seventeen regions, in one of its
 *     official spellings. Not a substring, not anywhere in the string — a
 *     street called "서울로" in Daejeon must not resolve to Seoul.
 *  2. A region match is what proves the country. Nothing else here returns KR.
 *  3. The city is the next token only when it ends in 시 / 군 / 구, the three
 *     suffixes that actually mark a municipality. Anything else is a road, a
 *     building or a number, and none of those is a city.
 *  4. Everything else is null, and the ORIGINAL address text is never
 *     translated, transliterated or rewritten by this module — it only reads.
 *
 * No model is consulted. A wrong region silently misplaces a job on a map the
 * candidate is filtering by.
 */

export interface KoreanAddress {
  countryCode: string | null;
  region: string | null;
  city: string | null;
}

const NONE: KoreanAddress = { countryCode: null, region: null, city: null };

/**
 * The seventeen 광역자치단체, each mapped from every spelling an address
 * actually uses to the short canonical form.
 *
 * Longest spellings are matched first, so "서울특별시" never matches as "서울"
 * and leaves "특별시" behind as a city.
 */
const REGIONS: Record<string, string> = {
  서울특별시: '서울',
  서울시: '서울',
  서울: '서울',
  부산광역시: '부산',
  부산시: '부산',
  부산: '부산',
  대구광역시: '대구',
  대구시: '대구',
  대구: '대구',
  인천광역시: '인천',
  인천시: '인천',
  인천: '인천',
  광주광역시: '광주',
  광주시: '광주',
  광주: '광주',
  대전광역시: '대전',
  대전시: '대전',
  대전: '대전',
  울산광역시: '울산',
  울산시: '울산',
  울산: '울산',
  세종특별자치시: '세종',
  세종시: '세종',
  세종: '세종',
  경기도: '경기',
  경기: '경기',
  강원특별자치도: '강원',
  강원도: '강원',
  강원: '강원',
  충청북도: '충북',
  충북: '충북',
  충청남도: '충남',
  충남: '충남',
  전북특별자치도: '전북',
  전라북도: '전북',
  전북: '전북',
  전라남도: '전남',
  전남: '전남',
  경상북도: '경북',
  경북: '경북',
  경상남도: '경남',
  경남: '경남',
  제주특별자치도: '제주',
  제주도: '제주',
  제주: '제주',
};

/** Spellings longest-first, so a longer form always wins. */
const REGION_SPELLINGS = Object.keys(REGIONS).sort(
  (a, b) => b.length - a.length,
);

/** 시 (city), 군 (county), 구 (district) — the municipality suffixes. */
const MUNICIPALITY = /(시|군|구)$/;

/**
 * Parse a Korean address, or return nothing.
 *
 * Returns nothing for a non-Korean address, for a place NAME ("부산지사" — an
 * office label, not an address) and for anything whose first token is not a
 * region. Refusing is the common case and the safe one.
 */
export function parseKoreanAddress(value: unknown): KoreanAddress {
  if (typeof value !== 'string') return NONE;
  const trimmed = value.trim();
  if (!trimmed) return NONE;

  const tokens = trimmed.split(/\s+/);
  const head = tokens[0];

  const spelling = REGION_SPELLINGS.find((candidate) => head === candidate);
  if (!spelling) return NONE;

  const region = REGIONS[spelling];
  const next = tokens[1];
  /*
   * A municipality suffix is required. "부산 해운대구 센텀중앙로 97" gives
   * 해운대구; "제주 서귀포시 ..." gives 서귀포시; "경기 성남시 분당구 ..." gives
   * 성남시, the larger of the two, because that is the token in the city
   * position. A road name like "센텀중앙로" is correctly refused.
   */
  const city = next && MUNICIPALITY.test(next) ? next : null;

  return { countryCode: 'KR', region, city };
}

/** Whether a string looks like a Korean domestic address. */
export function isKoreanAddress(value: unknown): boolean {
  return parseKoreanAddress(value).countryCode === 'KR';
}
