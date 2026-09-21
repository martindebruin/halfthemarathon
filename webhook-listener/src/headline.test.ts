import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  getTimeOfDayLabel,
  getSwedishDayLabel,
  getPlaceName,
  generateHeadline,
  buildHolidayFallback,
  buildPrompt,
  cleanTitle,
} from './headline.js';
import { describeOffset, isoDateInStockholm } from './kyrkoaret.js';
import type { Holiday } from './kyrkoaret.js';

const MICKELSMASS: Holiday = {
  sv: 'Mickelsmäss',
  la: 'S. Michaelis',
  kategori: 'massa',
  vad: 'Ärkeängeln Mikael.',
  varfor: 'Höstens stora räkenskapsdag och tjänstefolkets flyttdag.',
  offsetDays: 0,
};
const NO_FACTS = { distanceM: null, elevationGainM: null };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getTimeOfDayLabel', () => {
  it('returns "på morgonen" at 08:00 Stockholm winter', () => {
    // 08:00 Stockholm UTC+1 = 07:00 UTC
    expect(getTimeOfDayLabel(new Date('2026-01-15T07:00:00Z'))).toBe('på morgonen');
  });
  it('returns "på förmiddagen" at 10:30 Stockholm', () => {
    expect(getTimeOfDayLabel(new Date('2026-01-15T09:30:00Z'))).toBe('på förmiddagen');
  });
  it('returns "vid lunch" at 12:00 Stockholm', () => {
    expect(getTimeOfDayLabel(new Date('2026-01-15T11:00:00Z'))).toBe('vid lunch');
  });
  it('returns "på eftermiddagen" at 15:00 Stockholm', () => {
    expect(getTimeOfDayLabel(new Date('2026-01-15T14:00:00Z'))).toBe('på eftermiddagen');
  });
  it('returns "på kvällen" at 19:00 Stockholm', () => {
    expect(getTimeOfDayLabel(new Date('2026-01-15T18:00:00Z'))).toBe('på kvällen');
  });
  it('returns "på natten" at 23:00 Stockholm', () => {
    expect(getTimeOfDayLabel(new Date('2026-01-15T22:00:00Z'))).toBe('på natten');
  });
});

describe('getSwedishDayLabel', () => {
  it('returns "Juldagen" on Dec 25', () => {
    expect(getSwedishDayLabel(new Date('2026-12-25T12:00:00Z'))).toBe('Juldagen');
  });
  it('returns "Julafton" on Dec 24', () => {
    expect(getSwedishDayLabel(new Date('2026-12-24T12:00:00Z'))).toBe('Julafton');
  });
  it('returns "Påskdagen" on Easter 2026 (April 5)', () => {
    expect(getSwedishDayLabel(new Date('2026-04-05T12:00:00Z'))).toBe('Påskdagen');
  });
  it('returns "Långfredagen" on Good Friday 2026 (April 3)', () => {
    expect(getSwedishDayLabel(new Date('2026-04-03T12:00:00Z'))).toBe('Långfredagen');
  });
  it('returns "Nationaldagen" on June 6', () => {
    expect(getSwedishDayLabel(new Date('2026-06-06T12:00:00Z'))).toBe('Nationaldagen');
  });
  it('returns "Valborg" on April 30', () => {
    expect(getSwedishDayLabel(new Date('2026-04-30T12:00:00Z'))).toBe('Valborg');
  });
  it('returns "Midsommarafton" on June 19 2026 (Friday)', () => {
    expect(getSwedishDayLabel(new Date('2026-06-19T12:00:00Z'))).toBe('Midsommarafton');
  });
  it('returns "Måndag" on a regular Monday', () => {
    // Jan 12 2026 is a Monday
    expect(getSwedishDayLabel(new Date('2026-01-12T12:00:00Z'))).toBe('Måndag');
  });
  it('returns "Nyårsdagen" on Jan 1', () => {
    expect(getSwedishDayLabel(new Date('2026-01-01T12:00:00Z'))).toBe('Nyårsdagen');
  });
});

describe('getPlaceName', () => {
  it('returns city from Nominatim response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ address: { city: 'Strängnäs', country: 'Sverige' } }),
    }));
    expect(await getPlaceName(59.37, 17.03)).toBe('Strängnäs');
  });

  it('falls back to town when city absent', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ address: { town: 'Mariefred' } }),
    }));
    expect(await getPlaceName(59.25, 17.19)).toBe('Mariefred');
  });

  it('returns null on network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network')));
    expect(await getPlaceName(0, 0)).toBeNull();
  });
});

describe('generateHeadline', () => {
  it('returns the model title on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ message: { content: 'Räkenskapsdagen på Stora Essingen' } }),
    }));
    expect(await generateHeadline('Stockholm', 'Måndag', 'på kvällen', MICKELSMASS, NO_FACTS))
      .toBe('Räkenskapsdagen på Stora Essingen');
  });

  it('falls back to the holiday title when the model is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Timeout')));
    expect(await generateHeadline('Stockholm', 'Måndag', 'på kvällen', MICKELSMASS, NO_FACTS))
      .toBe('Mickelsmäss i Stockholm');
  });

  it('falls back to the holiday title when the model returns a rambling answer', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ message: { content: 'Visst! Här är en titel som fångar '.repeat(4) } }),
    }));
    expect(await generateHeadline('Stockholm', 'Måndag', 'på kvällen', MICKELSMASS, NO_FACTS))
      .toBe('Mickelsmäss i Stockholm');
  });

  it('falls back to the weekday title when no holiday resolved', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Timeout')));
    expect(await generateHeadline('Strängnäs', 'Måndag', 'på morgonen', null, NO_FACTS))
      .toBe('Måndagslöpning i Strängnäs på morgonen');
  });

  it('does not call the model at all when no holiday resolved', async () => {
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);
    await generateHeadline(null, 'Söndag', 'på kvällen', null, NO_FACTS);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('buildHolidayFallback', () => {
  it('names the day directly when the run is on it', () => {
    expect(buildHolidayFallback(MICKELSMASS, 'Stockholm')).toBe('Mickelsmäss i Stockholm');
  });
  it('omits the place when unknown', () => {
    expect(buildHolidayFallback(MICKELSMASS, null)).toBe('Mickelsmäss');
  });
  it('counts days forward to an upcoming day', () => {
    expect(buildHolidayFallback({ ...MICKELSMASS, offsetDays: 3 }, 'Stockholm'))
      .toBe('3 dagar före Mickelsmäss i Stockholm');
  });
  it('counts days back to a passed day', () => {
    expect(buildHolidayFallback({ ...MICKELSMASS, offsetDays: -4 }, 'Stockholm'))
      .toBe('4 dagar efter Mickelsmäss i Stockholm');
  });
  it('uses singular wording one day out', () => {
    expect(buildHolidayFallback({ ...MICKELSMASS, offsetDays: 1 }, null))
      .toBe('Dagen före Mickelsmäss');
    expect(buildHolidayFallback({ ...MICKELSMASS, offsetDays: -1 }, null))
      .toBe('Dagen efter Mickelsmäss');
  });
});

describe('buildPrompt', () => {
  it('includes the day, its meaning and the run facts', () => {
    const prompt = buildPrompt(MICKELSMASS, 'Stockholm', 'på kvällen', {
      distanceM: 5898.13,
      elevationGainM: 142,
    });
    expect(prompt).toContain('Mickelsmäss (S. Michaelis), samma dag som löpningen.');
    expect(prompt).toContain('tjänstefolkets flyttdag');
    expect(prompt).toContain('5,9 km');
    expect(prompt).toContain('142 m stigning');
    expect(prompt).toContain('på kvällen');
  });

  it('omits facts that are missing', () => {
    const prompt = buildPrompt(MICKELSMASS, null, 'vid lunch', NO_FACTS);
    expect(prompt).not.toContain('km');
    expect(prompt).not.toContain('stigning');
    expect(prompt).toContain('vid lunch');
  });
});

describe('cleanTitle', () => {
  it('strips quotes, arrows and a trailing period', () => {
    expect(cleanTitle('-> "Tröskningen på Essingen."')).toBe('Tröskningen på Essingen');
  });
  it('leaves a clean title untouched', () => {
    expect(cleanTitle('Slåttern avslutad i Knivsta')).toBe('Slåttern avslutad i Knivsta');
  });
});

describe('describeOffset', () => {
  it('describes the run landing on the day', () => {
    expect(describeOffset(0)).toBe('samma dag som löpningen');
  });
  it('describes an upcoming day', () => {
    expect(describeOffset(3)).toBe('om 3 dagar');
    expect(describeOffset(1)).toBe('dagen efter löpningen');
  });
  it('describes a passed day', () => {
    expect(describeOffset(-4)).toBe('4 dagar sedan');
    expect(describeOffset(-1)).toBe('dagen före löpningen');
  });
});

describe('isoDateInStockholm', () => {
  it('uses the Stockholm calendar day, not the UTC one', () => {
    // 23:30 UTC on Sep 20 is already Sep 21 in Stockholm (UTC+2)
    expect(isoDateInStockholm(new Date('2026-09-20T23:30:00Z'))).toBe('2026-09-21');
  });
  it('keeps the same day mid-afternoon', () => {
    expect(isoDateInStockholm(new Date('2026-09-21T16:25:23Z'))).toBe('2026-09-21');
  });
});

describe('generateHeadline options', () => {
  const MICKEL = {
    sv: 'Mickelsmäss', la: 'S. Michaelis', kategori: 'massa',
    vad: 'Ärkeängeln Mikael.', varfor: 'Höstens räkenskapsdag.', offsetDays: 0,
  };

  it('passes the avoid list into the prompt and honours temperature', async () => {
    const spy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ message: { content: 'Något annat i Knivsta' } }),
    });
    vi.stubGlobal('fetch', spy);
    await generateHeadline('Knivsta', 'Måndag', 'på kvällen', MICKEL, NO_FACTS, {
      temperature: 1.2,
      avoid: ['Julen dansades ut i Knivsta'],
    });
    const body = JSON.parse(spy.mock.calls[0][1].body);
    expect(body.options.temperature).toBe(1.2);
    expect(body.messages[1].content).toContain('Julen dansades ut i Knivsta');
    expect(body.messages[1].content).toContain('redan använda');
  });

  it('leaves the prompt untouched when no titles are excluded', async () => {
    const spy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ message: { content: 'Räkenskapsdagen i Knivsta' } }),
    });
    vi.stubGlobal('fetch', spy);
    await generateHeadline('Knivsta', 'Måndag', 'på kvällen', MICKEL, NO_FACTS);
    const body = JSON.parse(spy.mock.calls[0][1].body);
    expect(body.messages[1].content).not.toContain('redan använda');
    expect(body.options.temperature).toBe(0.95);
  });
});
