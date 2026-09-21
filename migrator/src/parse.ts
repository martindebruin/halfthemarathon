import { parse } from 'csv-parse/sync';
import fs from 'fs';
import type { RunkeeperActivity, PhotoRecord } from './types.js';

function parseDurationToSeconds(duration: string): number {
  const parts = duration.split(':').map(Number);
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  return 0;
}

function parsePaceToSeconds(pace: string): number | null {
  if (!pace) return null;
  const parts = pace.split(':').map(Number);
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return null;
}

export function parseCardioActivities(filePath: string): RunkeeperActivity[] {
  const content = fs.readFileSync(filePath, 'utf-8').replace(/^\uFEFF/, '');
  const records = parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as Record<string, string>[];

  return records.map((row) => ({
    activityId: row['Activity Id'],
    date: new Date(row['Date']),
    type: row['Type'],
    routeName: row['Route Name'] ?? '',
    distanceKm: parseFloat(row['Distance (km)']) || 0,
    durationSeconds: parseDurationToSeconds(row['Duration']),
    averagePaceSecondsPerKm: parsePaceToSeconds(row['Average Pace']),
    averageSpeedKmh: row['Average Speed (km/h)'] ? parseFloat(row['Average Speed (km/h)']) : null,
    caloriesBurned: row['Calories Burned'] ? parseFloat(row['Calories Burned)']) || parseFloat(row['Calories Burned']) : null,
    climbMeters: row['Climb (m)'] ? parseFloat(row['Climb (m)']) : null,
    averageHeartRate: row['Average Heart Rate (bpm)'] ? parseFloat(row['Average Heart Rate (bpm)']) || null : null,
    notes: row['Notes'] || null,
    gpxFile: row['GPX File'] || null,
  }));
}

export function parsePhotos(filePath: string): Map<string, PhotoRecord[]> {
  const content = fs.readFileSync(filePath, 'utf-8').replace(/^\uFEFF/, '');
  const records = parse(content, {
    columns: (headers: string[]) => headers.map((h) => h.trim()),
    skip_empty_lines: true,
    trim: true,
  }) as Record<string, string>[];

  const map = new Map<string, PhotoRecord[]>();

  for (const row of records) {
    const activityId = row['Activity Id'];
    if (!activityId) continue;

    let lat: number | null = null;
    let lng: number | null = null;
    const location = row['Location'] ?? '';
    if (location && location !== '0.0,0.0') {
      const parts = location.split(',');
      if (parts.length === 2) {
        lat = parseFloat(parts[0]);
        lng = parseFloat(parts[1]);
        if (isNaN(lat) || isNaN(lng)) { lat = null; lng = null; }
      }
    }

    const photo: PhotoRecord = {
      activityId,
      imageFileName: row['Image File Name'],
      uploadDate: row['Upload date'],
      caption: row['Text'] || null,
      lat,
      lng,
    };

    const existing = map.get(activityId) ?? [];
    existing.push(photo);
    map.set(activityId, existing);
  }

  return map;
}
