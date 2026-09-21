const KYRKOARET_URL = process.env.KYRKOARET_URL ?? 'https://holidays.martindebruin.com';

// Only högtider and mässdagar — the numbered Sundays after Trinity carry no
// agrarian duty to name a run after.
const CATEGORIES = 'hogtid,massa';

export interface Holiday {
  sv: string;
  la: string;
  kategori: string;
  vad: string;
  varfor: string;
  offsetDays: number;
}

interface NearestResponse {
  offset_days: number;
  holiday: {
    sv: string;
    la: string;
    kategori: string;
    vad: string;
    varfor: string;
  };
}

export function isoDateInStockholm(date: Date): string {
  return date.toLocaleDateString('sv-SE', { timeZone: 'Europe/Stockholm' });
}

export async function fetchNearestHoliday(date: Date): Promise<Holiday | null> {
  try {
    const deadline = isoDateInStockholm(date);
    const url = `${KYRKOARET_URL}/api/nearest?deadline=${deadline}&kategori=${CATEGORIES}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const data = await res.json() as NearestResponse;
    if (!data.holiday?.sv) return null;
    return { ...data.holiday, offsetDays: data.offset_days };
  } catch {
    return null;
  }
}

/** "samma dag" / "om 3 dagar" / "4 dagar sedan" — offset is holiday minus run. */
export function describeOffset(offsetDays: number): string {
  if (offsetDays === 0) return 'samma dag som löpningen';
  if (offsetDays === 1) return 'dagen efter löpningen';
  if (offsetDays === -1) return 'dagen före löpningen';
  if (offsetDays > 0) return `om ${offsetDays} dagar`;
  return `${-offsetDays} dagar sedan`;
}
