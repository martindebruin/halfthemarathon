export interface UploadPollResult {
  activity_id: number;
  duplicate_of?: number; // set when Strava detects a duplicate during processing
}

export interface RunkeeperActivity {
  activityId: string;
  date: Date;
  type: string;
  routeName: string;
  distanceKm: number;
  durationSeconds: number;
  averagePaceSecondsPerKm: number | null;
  averageSpeedKmh: number | null;
  caloriesBurned: number | null;
  climbMeters: number | null;
  averageHeartRate: number | null;
  notes: string | null;
  gpxFile: string | null;
}

export interface PhotoRecord {
  activityId: string;
  imageFileName: string;
  uploadDate: string;
  caption: string | null;
  lat: number | null;
  lng: number | null;
}

export interface StravaTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  token_type: string;
}

export interface StravaUploadResponse {
  id: number;
  id_str: string;
  external_id: string;
  error: string | null;
  status: string;
  activity_id: number | null;
}

export interface StravaActivity {
  id: number;
  name: string;
  distance: number;
  moving_time: number;
  elapsed_time: number;
  total_elevation_gain: number;
  type: string;
  sport_type: string;
  start_date: string;
  start_date_local: string;
  average_speed: number;
  max_speed: number;
  average_cadence?: number;
  average_watts?: number;
  average_heartrate?: number;
  max_heartrate?: number;
  map: {
    summary_polyline: string;
  };
  start_latlng: [number, number] | null;
  splits_metric?: SplitMetric[];
  laps?: object[];
  best_efforts?: object[];
  calories?: number;
  description?: string;
  gear_id?: string;
  suffer_score?: number;
  perceived_exertion?: number;
  pr_count?: number;
  achievement_count?: number;
  external_id?: string;
}

export interface SplitMetric {
  distance: number;
  elapsed_time: number;
  elevation_difference: number;
  moving_time: number;
  split: number;
  average_speed: number;
  average_heartrate?: number;
  pace_zone: number;
}

export interface ProgressState {
  completed: string[];
  failed: Array<{ id: string; error: string; attempts: number }>;
  lastRunAt: string;
}
