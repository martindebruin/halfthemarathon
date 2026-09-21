import { patchActivityName } from './directus.js';
import { fetchNearestHoliday, describeOffset, type Holiday } from './kyrkoaret.js';

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

const FRMWRK_AI_URL = process.env.FRMWRK_AI_URL ?? 'http://100.98.25.111:11434';
const FRMWRK_AI_MODEL = process.env.FRMWRK_AI_MODEL ?? 'gemma3:27b-it-q4_K_M';

const SYSTEM_PROMPT = `Du namnger löprundor efter kyrkoåret — de gamla svenska mässdagarna.

Tonen: torr, högtidlig, en smula absurd. Du låter som ett kalendarium som råkat
börja logga löprundor. Komiken ligger i allvaret, aldrig i skämtet.

Det viktigaste: använd vad dagen HANDLAR OM, inte bara dess namn. Varje mässdag
styrde en syssla — skörd, tröskning, räkenskaper, boskap hem från skogen, slåtter.
Låt den sysslan beskriva löprundan. Rundan blir dagens arbete.

Regler:
- EN naturlig svensk fras, 3-7 ord. Aldrig en rad substantiv efter varandra.
- Nämn dagen ELLER dess syssla — inte båda.
- Skedde löpningen inte på själva dagen: säg avståndet i dagar.
- Väv in EN konkret detalj från rundan. Bara en.
- Hitta inte på nya sammansatta ord.
- Skriv aldrig "samma dag" och upprepa inte datumet.
- En enda fras. Aldrig två meningar.
- Skriv aldrig i jag-form. Kalendariet talar aldrig om sig själv.
- Ingen punkt, inga citattecken, ingen förklaring. Svara enbart med titeln.

Exempel:

Dag: Larsmässa, samma dag som löpningen.
Dagens syssla: Slåtterns slut, höet skulle vara inne.
Rundan: Knivsta, 8,0 km
-> Slåttern avslutad i Knivsta

Dag: Korsmässa om hösten, samma dag som löpningen.
Dagens syssla: Boskapen togs hem från skogen.
Rundan: Stora Essingen, 6,7 km, 185 m stigning
-> Boskapen hem över Essingens backar

Dag: Mickelsmäss, om 3 dagar.
Dagens syssla: Höstens räkenskapsdag och tjänstefolkets flyttdag.
Rundan: Tallkrogen, 10,2 km
-> Tre dagar till flyttdagen, tio kilometer

Dag: Tiburtiusdagen, om 5 dagar.
Dagens syssla: Dagen björkarna skulle spricka ut.
Rundan: Halmstad, 4,1 km
-> Fem dagar innan björken spricker`;

export interface RunFacts {
  distanceM: number | null;
  elevationGainM: number | null;
}

/** Weekday-based title — last resort when no holiday could be resolved. */
export function buildWeekdayFallback(place: string | null, day: string, time: string): string {
  const parts = [`${day}slöpning`];
  if (place) parts.push(`i ${place}`);
  parts.push(time);
  return parts.join(' ');
}

/** Deterministic holiday title — used when the LLM is unreachable. */
export function buildHolidayFallback(holiday: Holiday, place: string | null): string {
  const where = place ? ` i ${place}` : '';
  const n = Math.abs(holiday.offsetDays);
  if (holiday.offsetDays === 0) return `${holiday.sv}${where}`;
  if (holiday.offsetDays > 0) {
    return n === 1 ? `Dagen före ${holiday.sv}${where}` : `${n} dagar före ${holiday.sv}${where}`;
  }
  return n === 1 ? `Dagen efter ${holiday.sv}${where}` : `${n} dagar efter ${holiday.sv}${where}`;
}

export function buildPrompt(
  holiday: Holiday,
  place: string | null,
  time: string,
  facts: RunFacts,
): string {
  const lines = [`Dag: ${holiday.sv} (${holiday.la}), ${describeOffset(holiday.offsetDays)}.`];
  if (holiday.vad) lines.push(`Om dagen: ${holiday.vad}`);
  if (holiday.varfor) lines.push(`Dagens syssla: ${holiday.varfor}`);
  const run: string[] = [];
  if (place) run.push(place);
  if (facts.distanceM != null) run.push(`${(facts.distanceM / 1000).toFixed(1).replace('.', ',')} km`);
  if (facts.elevationGainM != null) run.push(`${facts.elevationGainM} m stigning`);
  lines.push(`Rundan: ${run.join(', ')}`);
  lines.push(`Tidpunkt: ${time}`);
  return lines.join('\n');
}

/** Strip the model's occasional leading dash, quotes or trailing period. */
export function cleanTitle(raw: string): string {
  const firstLine = raw.trim().split('\n')[0];
  return firstLine
    .replace(/^->\s*/, '')
    .replace(/^["'«»]+|["'«»]+$/g, '')
    // A title is one phrase; anything after a sentence break is the model rambling.
    .split(/\.\s+/)[0]
    .replace(/\.$/, '')
    .trim();
}

export interface HeadlineOptions {
  /** Raise to push the model off phrasings it keeps reaching for. */
  temperature?: number;
  /** Titles already in use, which the model is told to avoid. */
  avoid?: string[];
}

export async function generateHeadline(
  place: string | null,
  day: string,
  time: string,
  holiday: Holiday | null,
  facts: RunFacts,
  opts: HeadlineOptions = {},
): Promise<string> {
  if (!holiday) return buildWeekdayFallback(place, day, time);
  const fallback = buildHolidayFallback(holiday, place);
  let prompt = buildPrompt(holiday, place, time, facts);
  if (opts.avoid?.length) {
    prompt += `\n\nDessa titlar är redan använda för andra rundor. Skriv något tydligt annat:\n`
      + opts.avoid.map((t) => `- ${t}`).join('\n');
  }
  try {
    const res = await fetch(`${FRMWRK_AI_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: FRMWRK_AI_MODEL,
        stream: false,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
        options: { temperature: opts.temperature ?? 0.95, num_predict: 40 },
      }),
      signal: AbortSignal.timeout(25000),
    });
    if (!res.ok) return fallback;
    const data = await res.json() as { message?: { content?: string } };
    const title = cleanTitle(data.message?.content ?? '');
    // A title longer than a headline means the model started explaining itself.
    if (!title || title.length > 60) return fallback;
    return title;
  } catch {
    return fallback;
  }
}

export async function generateAndSaveHeadline(
  activityId: string,
  startedAt: string,
  lat: number | null,
  lng: number | null,
  facts: RunFacts = { distanceM: null, elevationGainM: null },
): Promise<void> {
  const date = new Date(startedAt);
  const [place, holiday] = await Promise.all([
    lat != null && lng != null ? getPlaceName(lat, lng) : Promise.resolve(null),
    fetchNearestHoliday(date),
  ]);
  const day = getSwedishDayLabel(date);
  const time = getTimeOfDayLabel(date);
  const headline = await generateHeadline(place, day, time, holiday, facts);
  await patchActivityName(activityId, headline);
}
