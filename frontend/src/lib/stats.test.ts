import { describe, it, expect } from 'vitest';
import { calculateStreaks, calculatePersonalBests, computeRoutes, MILESTONES } from './stats.js';

describe('calculateStreaks', () => {
  it('returns 0 for no activities', () => {
    const { longest, current } = calculateStreaks([]);
    expect(longest).toBe(0);
    expect(current).toBe(0);
  });

  it('counts a single run as streak of 1', () => {
    const { longest, current } = calculateStreaks(['2024-01-01']);
    expect(longest).toBe(1);
  });

  it('counts consecutive days', () => {
    const { longest } = calculateStreaks(['2024-01-01', '2024-01-02', '2024-01-03']);
    expect(longest).toBe(3);
  });

  it('resets on a gap', () => {
    const { longest } = calculateStreaks(['2024-01-01', '2024-01-02', '2024-01-05', '2024-01-06']);
    expect(longest).toBe(2);
  });

  it('deduplicates multiple runs on same day', () => {
    const { longest } = calculateStreaks(['2024-01-01', '2024-01-01', '2024-01-02']);
    expect(longest).toBe(2);
  });
});

describe('calculatePersonalBests', () => {
  it('returns null for no activities', () => {
    const pbs = calculatePersonalBests([]);
    expect(pbs['5k']).toBeNull();
  });

  it('finds the minimum elapsed_time for a distance', () => {
    const activities = [
      { id: '1', date: '2024-01-01', best_efforts: JSON.stringify([{ name: '5k', elapsed_time: 1500, moving_time: 1500 }]) },
      { id: '2', date: '2024-02-01', best_efforts: JSON.stringify([{ name: '5k', elapsed_time: 1400, moving_time: 1400 }]) },
    ];
    const pbs = calculatePersonalBests(activities as never);
    expect(pbs['5k']?.elapsed_time).toBe(1400);
    expect(pbs['5k']?.activity_id).toBe('2');
  });
});

describe('MILESTONES', () => {
  it('has at least 2 entries', () => {
    expect(MILESTONES.length).toBeGreaterThanOrEqual(2);
  });
});

describe('computeRoutes', () => {
  it('returns empty array for no activities', () => {
    expect(computeRoutes([], [])).toEqual([]);
  });

  it('groups activities by route_name', () => {
    const activities = [
      { id: '1', date: '2024-01-01', name: 'Run', route_name: 'Djurgården', distance_m: 10000, moving_time_s: 3000, average_speed: 3.33, start_lat: null, start_lng: null, summary_polyline: null },
      { id: '2', date: '2024-01-08', name: 'Run', route_name: 'Djurgården', distance_m: 10000, moving_time_s: 2900, average_speed: 3.45, start_lat: null, start_lng: null, summary_polyline: null },
    ];
    const routes = computeRoutes(activities, []);
    expect(routes).toHaveLength(1);
    expect(routes[0].cluster_key).toBe('name:Djurgården');
    expect(routes[0].run_count).toBe(2);
  });

  it('groups unnamed activities by geo cluster', () => {
    const activities = [
      { id: '1', date: '2024-01-01', name: 'Morning Run', route_name: null, distance_m: 10200, moving_time_s: 3100, average_speed: null, start_lat: 59.333, start_lng: 18.065, summary_polyline: null },
      { id: '2', date: '2024-01-08', name: 'Morning Run', route_name: null, distance_m: 9800,  moving_time_s: 2950, average_speed: null, start_lat: 59.333, start_lng: 18.065, summary_polyline: null },
    ];
    const routes = computeRoutes(activities, []);
    expect(routes).toHaveLength(1);
    expect(routes[0].cluster_key).toBe('geo:59.333_18.065_10km');
    expect(routes[0].run_count).toBe(2);
    expect(routes[0].display_name).toBe('Morning Run');
  });

  it('applies alias override for display name', () => {
    const activities = [
      { id: '1', date: '2024-01-01', name: 'Morning Run', route_name: null, distance_m: 10000, moving_time_s: 3000, average_speed: 3.33, start_lat: 59.333, start_lng: 18.065, summary_polyline: null },
    ];
    const aliases = [{ cluster_key: 'geo:59.333_18.065_10km', display_name: 'Ladugårdsparken Loop' }];
    const routes = computeRoutes(activities, aliases);
    expect(routes[0].display_name).toBe('Ladugårdsparken Loop');
  });

  it('picks best pace as lowest s/km', () => {
    const activities = [
      { id: '1', date: '2024-01-01', name: 'Run', route_name: 'Park Loop', distance_m: 5000, moving_time_s: 1500, average_speed: 3.33, start_lat: null, start_lng: null, summary_polyline: null },
      { id: '2', date: '2024-01-08', name: 'Run', route_name: 'Park Loop', distance_m: 5000, moving_time_s: 1400, average_speed: 3.57, start_lat: null, start_lng: null, summary_polyline: null },
    ];
    const routes = computeRoutes(activities, []);
    // best speed is 3.57 m/s → 1000/3.57 ≈ 280 s/km
    expect(routes[0].best_pace_s_km).toBe(Math.round(1000 / 3.57));
  });

  it('picks best time from same-distance runs (within 10% of median)', () => {
    const activities = [
      { id: '1', date: '2024-01-01', name: 'Run', route_name: 'Loop', distance_m: 10000, moving_time_s: 3200, average_speed: 3.13, start_lat: null, start_lng: null, summary_polyline: null },
      { id: '2', date: '2024-01-08', name: 'Run', route_name: 'Loop', distance_m: 10000, moving_time_s: 3000, average_speed: 3.33, start_lat: null, start_lng: null, summary_polyline: null },
    ];
    const routes = computeRoutes(activities, []);
    expect(routes[0].best_time_s).toBe(3000);
  });

  it('sorts by run_count descending', () => {
    const activities = [
      { id: '1', date: '2024-01-01', name: 'A', route_name: 'Short', distance_m: 5000, moving_time_s: 1500, average_speed: 3.33, start_lat: null, start_lng: null, summary_polyline: null },
      { id: '2', date: '2024-01-01', name: 'B', route_name: 'Long',  distance_m: 15000, moving_time_s: 4500, average_speed: 3.33, start_lat: null, start_lng: null, summary_polyline: null },
      { id: '3', date: '2024-01-08', name: 'B', route_name: 'Long',  distance_m: 15000, moving_time_s: 4400, average_speed: 3.41, start_lat: null, start_lng: null, summary_polyline: null },
    ];
    const routes = computeRoutes(activities, []);
    expect(routes[0].cluster_key).toBe('name:Long');
    expect(routes[1].cluster_key).toBe('name:Short');
  });

  it('excludes activities with no route_name and no geo data', () => {
    const activities = [
      { id: '1', date: '2024-01-01', name: 'Run', route_name: null, distance_m: 5000, moving_time_s: 1500, average_speed: 3.33, start_lat: null, start_lng: null, summary_polyline: null },
    ];
    expect(computeRoutes(activities, [])).toHaveLength(0);
  });

  it('includes runs array sorted by date descending', () => {
    const activities = [
      { id: '1', date: '2024-01-01', name: 'Run', route_name: 'Loop', distance_m: 5000, moving_time_s: 1500, average_speed: 3.33, start_lat: null, start_lng: null, summary_polyline: null },
      { id: '2', date: '2024-02-01', name: 'Run', route_name: 'Loop', distance_m: 5000, moving_time_s: 1400, average_speed: 3.57, start_lat: null, start_lng: null, summary_polyline: null },
    ];
    const routes = computeRoutes(activities, []);
    expect(routes[0].runs).toHaveLength(2);
    expect(routes[0].runs[0].id).toBe('2'); // most recent first
    expect(routes[0].runs[1].id).toBe('1');
  });

  it('sets sample_polyline from the fastest run', () => {
    const activities = [
      { id: '1', date: '2024-01-01', name: 'Run', route_name: 'Loop', distance_m: 5000, moving_time_s: 1500, average_speed: 3.33, start_lat: null, start_lng: null, summary_polyline: 'polyA' },
      { id: '2', date: '2024-02-01', name: 'Run', route_name: 'Loop', distance_m: 5000, moving_time_s: 1400, average_speed: 3.57, start_lat: null, start_lng: null, summary_polyline: 'polyB' },
    ];
    const routes = computeRoutes(activities, []);
    expect(routes[0].sample_polyline).toBe('polyB'); // run 2 is faster (3.57 m/s)
  });

  it('sets sample_polyline to null when no run has a polyline', () => {
    const activities = [
      { id: '1', date: '2024-01-01', name: 'Run', route_name: 'Loop', distance_m: 5000, moving_time_s: 1500, average_speed: 3.33, start_lat: null, start_lng: null, summary_polyline: null },
    ];
    const routes = computeRoutes(activities, []);
    expect(routes[0].sample_polyline).toBeNull();
  });

  it('includes runs with null time_s for activities without moving_time_s', () => {
    const activities = [
      { id: '1', date: '2024-01-01', name: 'Run', route_name: 'Loop', distance_m: 5000, moving_time_s: null, average_speed: null, start_lat: null, start_lng: null, summary_polyline: null },
    ];
    const routes = computeRoutes(activities, []);
    expect(routes[0].runs).toHaveLength(1);
    expect(routes[0].runs[0].time_s).toBeNull();
  });
});
