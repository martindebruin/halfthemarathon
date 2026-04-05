<script lang="ts">
  import polylineLib from '@mapbox/polyline';

  let {
    summaryPolyline,
    startLat,
    startLng,
    height = '360px',
  }: {
    summaryPolyline: string;
    startLat: number | null;
    startLng: number | null;
    height?: string;
  } = $props();

  let mapEl: HTMLDivElement | undefined = $state(undefined);

  $effect(() => {
    if (!mapEl) return;

    let map: import('leaflet').Map | undefined;

    (async () => {
      const L = (await import('leaflet')).default;

      const coords = polylineLib.decode(summaryPolyline) as [number, number][];
      if (coords.length === 0) return;

      map = L.map(mapEl!);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 18,
      }).addTo(map);

      const polyline = L.polyline(coords, { color: '#f97316', weight: 3, opacity: 0.9 });
      polyline.addTo(map);
      map.fitBounds(polyline.getBounds(), { padding: [16, 16] });

      L.circleMarker(coords[0], {
        radius: 6,
        color: '#22c55e',
        fillColor: '#22c55e',
        fillOpacity: 1,
        weight: 2,
      }).addTo(map);

      L.circleMarker(coords[coords.length - 1], {
        radius: 6,
        color: '#f97316',
        fillColor: '#f97316',
        fillOpacity: 1,
        weight: 2,
      }).addTo(map);
    })();

    return () => map?.remove();
  });
</script>

<div bind:this={mapEl} style="height: {height}; width: 100%; background: #111;"></div>
