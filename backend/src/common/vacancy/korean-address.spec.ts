import { isKoreanAddress, parseKoreanAddress } from './korean-address';

/**
 * Korean address parsing.
 *
 * Mostly refusals, as with every normalization layer in this product: an
 * unplaced job costs a ranking signal, a misplaced one is hidden behind a
 * location filter the candidate set and nobody ever finds out why.
 */

describe('parseKoreanAddress', () => {
  describe('the documented shape', () => {
    it('parses the address from the official API sample', () => {
      expect(parseKoreanAddress('부산 해운대구 센텀중앙로 97')).toEqual({
        countryCode: 'KR',
        region: '부산',
        city: '해운대구',
      });
    });
  });

  describe('regions', () => {
    it.each([
      ['서울 강남구 테헤란로 123', '서울', '강남구'],
      ['서울특별시 강남구 테헤란로 123', '서울', '강남구'],
      ['부산광역시 해운대구 센텀중앙로 97', '부산', '해운대구'],
      ['대구 수성구 동대구로 1', '대구', '수성구'],
      ['인천 연수구 송도과학로 10', '인천', '연수구'],
      ['광주 서구 상무중앙로 5', '광주', '서구'],
      ['대전 유성구 대학로 99', '대전', '유성구'],
      ['울산 남구 삼산로 200', '울산', '남구'],
      ['세종특별자치시 한누리대로 2130', '세종', null],
      ['경기 성남시 분당구 판교역로 235', '경기', '성남시'],
      ['경기도 수원시 영통구 광교로 145', '경기', '수원시'],
      ['강원특별자치도 춘천시 중앙로 1', '강원', '춘천시'],
      ['충북 청주시 상당구 상당로 82', '충북', '청주시'],
      ['충남 천안시 서북구 불당대로 77', '충남', '천안시'],
      ['전북특별자치도 전주시 완산구 효자로 225', '전북', '전주시'],
      ['전남 무안군 삼향읍 오룡길 1', '전남', '무안군'],
      ['경북 포항시 남구 지곡로 80', '경북', '포항시'],
      ['경남 창원시 의창구 중앙대로 300', '경남', '창원시'],
      ['제주특별자치도 제주시 문연로 6', '제주', '제주시'],
    ])('parses %s', (address, region, city) => {
      expect(parseKoreanAddress(address)).toEqual({
        countryCode: 'KR',
        region,
        city,
      });
    });

    it('prefers the longest spelling so no suffix leaks into the city', () => {
      // "서울특별시" must not match as "서울" and leave "특별시" behind.
      expect(parseKoreanAddress('서울특별시 종로구 세종대로 175').city).toBe(
        '종로구',
      );
    });
  });

  describe('refusals', () => {
    it('refuses a region that is not at the start', () => {
      // A road named 서울로 in Daejeon is not in Seoul.
      expect(parseKoreanAddress('대전 중구 서울로 20')).toEqual({
        countryCode: 'KR',
        region: '대전',
        city: '중구',
      });
      expect(parseKoreanAddress('무슨빌딩 서울 어딘가').countryCode).toBeNull();
    });

    it('refuses a site LABEL rather than an address', () => {
      // "부산지사" is "Busan branch" — an office name, not an address.
      expect(parseKoreanAddress('부산지사').countryCode).toBeNull();
      expect(parseKoreanAddress('본사').countryCode).toBeNull();
    });

    it('refuses a non-Korean address', () => {
      for (const address of [
        '1 Infinite Loop, Cupertino, CA',
        'London, England, United Kingdom',
        'Remote',
        '',
        '   ',
      ]) {
        expect(parseKoreanAddress(address).countryCode).toBeNull();
      }
    });

    it('refuses non-strings', () => {
      for (const value of [null, undefined, 42, {}, []]) {
        expect(parseKoreanAddress(value)).toEqual({
          countryCode: null,
          region: null,
          city: null,
        });
      }
    });

    it('does not call a road name a city', () => {
      // Only 시/군/구 mark a municipality.
      expect(parseKoreanAddress('서울 테헤란로 123').city).toBeNull();
      expect(parseKoreanAddress('서울 테헤란로 123').region).toBe('서울');
    });

    it('yields a region with no city when none follows', () => {
      expect(parseKoreanAddress('제주')).toEqual({
        countryCode: 'KR',
        region: '제주',
        city: null,
      });
    });
  });

  describe('the source text is only read, never rewritten', () => {
    it('returns Korean tokens as Korean', () => {
      const parsed = parseKoreanAddress('부산 해운대구 센텀중앙로 97');
      // Not romanized, not translated, not transliterated.
      expect(parsed.region).toBe('부산');
      expect(parsed.city).toBe('해운대구');
      expect(parsed.region).not.toMatch(/[A-Za-z]/);
    });

    it('is deterministic — no model, no locale service', () => {
      const first = parseKoreanAddress('서울 강남구 테헤란로 123');
      const second = parseKoreanAddress('서울 강남구 테헤란로 123');
      expect(first).toEqual(second);
    });
  });
});

describe('isKoreanAddress', () => {
  it('is true only for a parseable domestic address', () => {
    expect(isKoreanAddress('부산 해운대구 센텀중앙로 97')).toBe(true);
    expect(isKoreanAddress('부산지사')).toBe(false);
    expect(isKoreanAddress('Seoul, South Korea')).toBe(false);
  });
});
