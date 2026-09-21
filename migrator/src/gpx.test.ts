import { describe, it, expect } from 'vitest';
import { extractTrackpoints } from './gpx.js';

const SAMPLE_GPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
<trk><trkseg>
<trkpt lat="57.000000" lon="11.000000"><ele>10.0</ele></trkpt>
<trkpt lat="57.001000" lon="11.001000"><ele>11.0</ele></trkpt>
<trkpt lat="57.002000" lon="11.002000"><ele>12.0</ele></trkpt>
</trkseg></trk>
</gpx>`;

describe('extractTrackpoints', () => {
  it('parses lat/lng from GPX content', () => {
    const points = extractTrackpoints(SAMPLE_GPX);
    expect(points).toHaveLength(3);
    expect(points[0]).toEqual([57.0, 11.0]);
    expect(points[1]).toEqual([57.001, 11.001]);
    expect(points[2]).toEqual([57.002, 11.002]);
  });

  it('returns empty array for GPX with no trackpoints', () => {
    expect(extractTrackpoints('<gpx></gpx>')).toEqual([]);
  });

  it('subsamples when there are more than 500 points', () => {
    const trkpts = Array.from({ length: 1000 }, (_, i) =>
      `<trkpt lat="${(57 + i * 0.0001).toFixed(4)}" lon="${(11 + i * 0.0001).toFixed(4)}"></trkpt>`
    ).join('\n');
    const gpx = `<gpx><trk><trkseg>${trkpts}</trkseg></trk></gpx>`;

    const points = extractTrackpoints(gpx);
    expect(points.length).toBeLessThanOrEqual(500);
    expect(points[0][0]).toBeCloseTo(57.0, 3);
    expect(points[points.length - 1][0]).toBeCloseTo(57 + 999 * 0.0001, 3);
  });

  it('returns all points when count is exactly 500', () => {
    const trkpts = Array.from({ length: 500 }, (_, i) =>
      `<trkpt lat="${(57 + i * 0.0001).toFixed(4)}" lon="${(11 + i * 0.0001).toFixed(4)}"></trkpt>`
    ).join('\n');
    const gpx = `<gpx><trk><trkseg>${trkpts}</trkseg></trk></gpx>`;
    const points = extractTrackpoints(gpx);
    expect(points).toHaveLength(500);
  });
});
