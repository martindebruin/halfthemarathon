import { patchActivityName } from './directus.js';

// Local Stockholm time from a UTC Date
function toStockholm(date: Date): Date {
  return new Date(date.toLocaleString('en-US', { timeZone: 'Europe/Stockholm' }));
}

export function getTimeOfDayLabel(date: Date): string {
  const local = toStockholm(date);
  const min = local.getHours() * 60 + local.getMinutes();
  if (min >= 5 * 60 && min < 10 * 60) return 'på morgonen';
  if (min >= 10 * 60 && min < 11 * 60 + 30) return 'på förmiddagen';
  if (min >= 11 * 60 + 30 && min <= 13 * 60 + 30) return 'vid lunch';
  if (min > 13 * 60 + 30 && min < 17 * 60) return 'på eftermiddagen';
  if (min >= 17 * 60 && min < 21 * 60) return 'på kvällen';
  return 'på natten';
}

// Anonymous Gregorian algorithm — returns UTC midnight of Easter Sunday
function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 1-indexed
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

function addDays(d: Date, n: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n));
}

function sameDay(a: Date, b: Date): boolean {
  return a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate();
}

export function getSwedishDayLabel(date: Date): string {
  const local = toStockholm(date);
  const year = local.getFullYear();
  const month = local.getMonth() + 1;
  const day = local.getDate();
  const dow = local.getDay(); // 0=Sunday

  // Fixed public holidays
  const fixed: Array<[number, number, string]> = [
    [1, 1, 'Nyårsdagen'],
    [1, 6, 'Trettondedag jul'],
    [4, 30, 'Valborg'],
    [6, 6, 'Nationaldagen'],
    [12, 24, 'Julafton'],
    [12, 25, 'Juldagen'],
    [12, 26, 'Annandag jul'],
    [12, 31, 'Nyårsafton'],
  ];
  for (const [m, d, name] of fixed) {
    if (month === m && day === d) return name;
  }

  // Easter-relative holidays
  const easter = easterSunday(year);
  const easterRelative: Array<[number, string]> = [
    [-2, 'Långfredagen'],
    [-1, 'Påskafton'],
    [0, 'Påskdagen'],
    [1, 'Annandag påsk'],
    [39, 'Kristi himmelsfärdsdag'],
    [49, 'Pingstdagen'],
  ];
  // Use UTC date of the local day for comparison
  const localUtc = new Date(Date.UTC(year, month - 1, day));
  for (const [offset, name] of easterRelative) {
    if (sameDay(localUtc, addDays(easter, offset))) return name;
  }

  // Midsommarafton: Friday Jun 19–25
  if (month === 6 && dow === 5 && day >= 19 && day <= 25) return 'Midsommarafton';
  // Midsommardagen: Saturday Jun 20–26
  if (month === 6 && dow === 6 && day >= 20 && day <= 26) return 'Midsommardagen';
  // Alla helgons dag: Saturday Oct 31 – Nov 6
  if (((month === 10 && day === 31) || (month === 11 && day <= 6)) && dow === 6) return 'Alla helgons dag';

  const WEEKDAYS = ['Söndag', 'Måndag', 'Tisdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lördag'];
  return WEEKDAYS[dow];
}

export async function getPlaceName(lat: number, lon: number): Promise<string | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&accept-language=sv`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'htmitub-run-recorder/1.0' },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = await res.json() as { address?: Record<string, string> };
    const addr = data.address ?? {};
    return addr.city ?? addr.town ?? addr.village ?? addr.municipality ?? null;
  } catch {
    return null;
  }
}

function buildFallback(place: string | null, day: string, time: string): string {
  const parts = [`${day}slöpning`];
  if (place) parts.push(`i ${place}`);
  parts.push(time);
  return parts.join(' ');
}

export async function generateHeadline(
  place: string | null,
  day: string,
  time: string,
): Promise<string> {
  const fallback = buildFallback(place, day, time);
  try {
    const lines: string[] = [];
    if (place) lines.push(`Plats: ${place}.`);
    lines.push(`Tid: ${time}.`);
    lines.push(`Dag: ${day}.`);
    lines.push('Ge mig en löpartitel.');

    const res = await fetch('http://100.98.25.111:8080/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'mistral-small:24b',
        messages: [
          {
            role: 'system',
            content: 'Du är en assistent som genererar korta, naturliga svenska titlar för löprundor. Svara ENBART med titeln, inget annat. Titeln ska vara 4–7 ord, casual och beskrivande.',
          },
          { role: 'user', content: lines.join(' ') },
        ],
        max_tokens: 30,
        temperature: 0.8,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return fallback;
    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content?.trim();
    return content || fallback;
  } catch {
    return fallback;
  }
}

export async function generateAndSaveHeadline(
  activityId: string,
  startedAt: string,
  lat: number | null,
  lng: number | null,
): Promise<void> {
  const date = new Date(startedAt);
  const [place, day, time] = await Promise.all([
    lat != null && lng != null ? getPlaceName(lat, lng) : Promise.resolve(null),
    Promise.resolve(getSwedishDayLabel(date)),
    Promise.resolve(getTimeOfDayLabel(date)),
  ]);
  const headline = await generateHeadline(place, day, time);
  await patchActivityName(activityId, headline);
}
