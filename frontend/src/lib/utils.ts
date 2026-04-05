export function formatDistance(meters: number | null): string {
  if (meters == null) return '—';
  return (meters / 1000).toFixed(2) + ' km';
}

export function formatPace(speed: number | null): string {
  // speed in m/s → min/km
  if (!speed || speed === 0) return '—';
  const secondsPerKm = 1000 / speed;
  const min = Math.floor(secondsPerKm / 60);
  const sec = Math.round(secondsPerKm % 60);
  return `${min}:${sec.toString().padStart(2, '0')} /km`;
}

export function formatDuration(seconds: number | null): string {
  if (seconds == null) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('sv-SE', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatHeartRate(bpm: number | null): string {
  if (bpm == null) return '—';
  return `${Math.round(bpm)} bpm`;
}

export function decodePolyline(encoded: string | null): Array<[number, number]> {
  if (!encoded) return [];
  // Google Encoded Polyline decoder
  let index = 0;
  const result: Array<[number, number]> = [];
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let shift = 0;
    let result_val = 0;
    let byte: number;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result_val |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    const dlat = result_val & 1 ? ~(result_val >> 1) : result_val >> 1;
    lat += dlat;

    shift = 0;
    result_val = 0;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result_val |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    const dlng = result_val & 1 ? ~(result_val >> 1) : result_val >> 1;
    lng += dlng;

    result.push([lat / 1e5, lng / 1e5]);
  }

  return result;
}

export function polylineToSvgPath(encoded: string | null, width = 200, height = 120, maxPoints = 60): string {
  const all = decodePolyline(encoded);
  if (all.length < 2) return '';

  // Subsample for thumbnail rendering to keep HTML size manageable
  let coords = all;
  if (all.length > maxPoints) {
    const step = Math.floor(all.length / maxPoints);
    coords = all.filter((_, i) => i % step === 0 || i === all.length - 1);
  }

  const lats = coords.map(([lat]) => lat);
  const lngs = coords.map(([, lng]) => lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const latRange = maxLat - minLat || 0.001;
  const lngRange = maxLng - minLng || 0.001;
  const padding = 8;

  const points = coords.map(([lat, lng]) => {
    const x = padding + ((lng - minLng) / lngRange) * (width - padding * 2);
    const y = padding + ((maxLat - lat) / latRange) * (height - padding * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  return points.join(' ');
}

export function computedSpeed(distance_m: number | null, moving_time_s: number | null): number | null {
  if (!distance_m || !moving_time_s) return null;
  return distance_m / moving_time_s;
}
