import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  getTimeOfDayLabel,
  getSwedishDayLabel,
  getPlaceName,
  generateHeadline,
} from './headline.js';

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
  it('returns LLM response on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'Påsklöpning i Strängnäs vid lunch' } }],
      }),
    }));
    expect(await generateHeadline('Strängnäs', 'Påskdagen', 'vid lunch'))
      .toBe('Påsklöpning i Strängnäs vid lunch');
  });

  it('returns fallback with place when LLM fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Timeout')));
    expect(await generateHeadline('Strängnäs', 'Måndag', 'på morgonen'))
      .toBe('Måndagslöpning i Strängnäs på morgonen');
  });

  it('returns fallback without place when place is null', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Timeout')));
    expect(await generateHeadline(null, 'Söndag', 'på kvällen'))
      .toBe('Söndagslöpning på kvällen');
  });
});
