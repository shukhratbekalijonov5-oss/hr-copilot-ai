import {
  countryCodeFromName,
  foldCountryName,
  parseLocationString,
} from './country-names';

/**
 * The country dictionary.
 *
 * The bar throughout: a wrong code is worse than no code. An unknown country
 * costs a ranking signal; a wrong one can hide a job behind a location filter
 * the candidate set, and nobody ever finds out why.
 */

describe('countryCodeFromName', () => {
  describe('names real job boards write', () => {
    it.each([
      ['United Kingdom', 'GB'],
      ['United States', 'US'],
      ['Germany', 'DE'],
      ['France', 'FR'],
      ['Singapore', 'SG'],
      ['South Korea', 'KR'],
      ['Japan', 'JP'],
      ['Australia', 'AU'],
      ['India', 'IN'],
      ['Ireland', 'IE'],
      ['Israel', 'IL'],
      ['Italy', 'IT'],
      ['Canada', 'CA'],
      ['Uzbekistan', 'UZ'],
    ])('%s -> %s', (name, code) => {
      expect(countryCodeFromName(name)).toBe(code);
    });
  });

  describe('aliases and spellings', () => {
    it.each([
      ['USA', 'US'],
      ['U.S.A.', 'US'],
      ['United States of America', 'US'],
      ['UK', 'GB'],
      ['Great Britain', 'GB'],
      ['The Netherlands', 'NL'],
      ['Holland', 'NL'],
      ['Czech Republic', 'CZ'],
      ['Czechia', 'CZ'],
      ['Türkiye', 'TR'],
      ['Turkey', 'TR'],
      ['Republic of Korea', 'KR'],
      ['대한민국', 'KR'],
      ['Viet Nam', 'VN'],
      ['Vietnam', 'VN'],
      ["Côte d'Ivoire", 'CI'],
      ['Ivory Coast', 'CI'],
    ])('%s -> %s', (name, code) => {
      expect(countryCodeFromName(name)).toBe(code);
    });

    it('maps UK to GB rather than treating it as an ISO code', () => {
      // "UK" is two uppercase letters but is not the ISO code for anything.
      expect(countryCodeFromName('UK')).toBe('GB');
    });

    it('is insensitive to case, spacing and punctuation', () => {
      for (const spelling of [
        'south korea',
        'SOUTH KOREA',
        '  South   Korea  ',
        'South-Korea',
      ]) {
        expect(countryCodeFromName(spelling)).toBe('KR');
      }
    });
  });

  describe('codes pass through', () => {
    it('accepts an alpha-2 code directly', () => {
      expect(countryCodeFromName('kr')).toBe('KR');
      expect(countryCodeFromName('DE')).toBe('DE');
    });
  });

  describe('refusals', () => {
    it('never resolves a prefix or a fragment', () => {
      // "Ind" is not evidence for India over Indonesia.
      for (const fragment of ['Ind', 'Ger', 'Kor', 'United', 'Republic of']) {
        expect(countryCodeFromName(fragment)).toBeNull();
      }
    });

    it('refuses a bare "Korea", which names two countries', () => {
      // The table defines "South Korea" and "North Korea" and deliberately
      // not the ambiguous stem. Resolving it to the more common one would be
      // a coin flip with someone's job search on it.
      expect(countryCodeFromName('Korea')).toBeNull();
      expect(countryCodeFromName('South Korea')).toBe('KR');
      expect(countryCodeFromName('North Korea')).toBe('KP');
    });

    it('refuses regional groupings', () => {
      for (const region of [
        'EMEA',
        'APAC',
        'AMER',
        'LATAM',
        'Europe',
        'Remote',
      ]) {
        expect(countryCodeFromName(region)).toBeNull();
      }
    });

    it('refuses cities', () => {
      for (const city of ['London', 'Berlin', 'Seoul', 'New York']) {
        expect(countryCodeFromName(city)).toBeNull();
      }
    });

    it('refuses non-strings and empties', () => {
      expect(countryCodeFromName(null)).toBeNull();
      expect(countryCodeFromName(undefined)).toBeNull();
      expect(countryCodeFromName(42)).toBeNull();
      expect(countryCodeFromName('')).toBeNull();
      expect(countryCodeFromName('   ')).toBeNull();
    });

    it('refuses an invented country', () => {
      expect(countryCodeFromName('Freedonia')).toBeNull();
      expect(countryCodeFromName('Nowhere Islands')).toBeNull();
    });
  });

  it('never consults a model or a locale service', () => {
    // Deterministic by construction: same input, same output, no I/O.
    expect(countryCodeFromName('Germany')).toBe(countryCodeFromName('Germany'));
  });
});

describe('foldCountryName', () => {
  it('strips diacritics, punctuation and articles', () => {
    expect(foldCountryName("Côte d'Ivoire")).toBe('cote d ivoire');
    expect(foldCountryName('The Netherlands')).toBe('netherlands');
  });
});

describe('parseLocationString', () => {
  it('reads City, Region, Country', () => {
    expect(parseLocationString('London, England, United Kingdom')).toEqual({
      countryCode: 'GB',
      region: 'England',
      city: 'London',
    });
  });

  it('reads City, Country', () => {
    expect(parseLocationString('Berlin, Germany')).toEqual({
      countryCode: 'DE',
      region: null,
      city: 'Berlin',
    });
  });

  it('reads a bare country', () => {
    expect(parseLocationString('Singapore')).toEqual({
      countryCode: 'SG',
      region: null,
      city: null,
    });
  });

  it('finds the country by lookup, not by position', () => {
    // A real Greenhouse office reads "Tokyo Prefecture, Japan" — two segments
    // where the first is a region, not a city. Position-based parsing gets
    // this wrong in both directions.
    expect(parseLocationString('Tokyo Prefecture, Japan').countryCode).toBe(
      'JP',
    );
  });

  it('yields nothing for a regional grouping', () => {
    for (const label of ['EMEA', 'Remote - AMER', 'APAC']) {
      expect(parseLocationString(label)).toEqual({
        countryCode: null,
        region: null,
        city: null,
      });
    }
  });

  it('does not call an unrecognized single segment a city', () => {
    // Storing "EMEA" as a city would make it filterable as one.
    expect(parseLocationString('EMEA').city).toBeNull();
  });

  it('yields nothing when no segment is a country', () => {
    expect(parseLocationString('San Francisco Bay Area')).toEqual({
      countryCode: null,
      region: null,
      city: null,
    });
  });

  it('handles a multi-city string by refusing it', () => {
    // "San Francisco, CA • New York, NY • United States" has no comma-separated
    // final country segment this can trust.
    const parsed = parseLocationString(
      'San Francisco, CA • New York, NY • United States',
    );
    expect(parsed.countryCode).toBeNull();
  });

  it('handles empty and non-string input', () => {
    expect(parseLocationString('')).toEqual({
      countryCode: null,
      region: null,
      city: null,
    });
    expect(parseLocationString(null).countryCode).toBeNull();
    expect(parseLocationString(undefined).countryCode).toBeNull();
  });

  it('tolerates trailing separators and extra whitespace', () => {
    expect(parseLocationString('  Berlin ,  Germany , ').countryCode).toBe(
      'DE',
    );
  });
});
