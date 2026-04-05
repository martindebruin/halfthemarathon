<script lang="ts">
  import polylineLib from '@mapbox/polyline';

  let {
    polyline,
    title,
    onclose,
  }: {
    polyline: string;
    title: string;
    onclose: () => void;
  } = $props();

  let mapEl: HTMLDivElement | undefined = $state(undefined);

  $effect(() => {
    if (!mapEl) return;
    let map: import('leaflet').Map | undefined;
    (async () => {
      const L = (await import('leaflet')).default;
      const coords = polylineLib.decode(polyline) as [number, number][];
      if (coords.length === 0) return;
      map = L.map(mapEl!);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 18,
      }).addTo(map);
      const line = L.polyline(coords, { color: '#f97316', weight: 3, opacity: 0.9 });
      line.addTo(map);
      map.fitBounds(line.getBounds(), { padding: [16, 16] });
      L.circleMarker(coords[0], { radius: 6, color: '#22c55e', fillColor: '#22c55e', fillOpacity: 1, weight: 2 }).addTo(map);
      L.circleMarker(coords[coords.length - 1], { radius: 6, color: '#f97316', fillColor: '#f97316', fillOpacity: 1, weight: 2 }).addTo(map);
    })();
    return () => map?.remove();
  });
</script>

<div class="overlay" role="none" onclick={onclose} onkeydown={(e) => { if (e.key === 'Escape') onclose(); }}>
  <div class="modal" role="dialog" aria-modal="true" aria-label={title} onclick={(e) => e.stopPropagation()}>
    <div class="modal-header">
      <span class="modal-title">{title}</span>
      <button class="close-btn" onclick={onclose} aria-label="Close">×</button>
    </div>
    <div class="map-container" bind:this={mapEl}></div>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.75);
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .modal {
    background: var(--surface);
    border: 1px solid var(--border);
    width: min(600px, 90vw);
    display: flex;
    flex-direction: column;
  }
  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.75rem 1rem;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }
  .modal-title { font-size: 0.85rem; font-weight: 500; }
  .close-btn {
    background: none;
    border: none;
    color: var(--muted);
    cursor: pointer;
    font-size: 1.4rem;
    padding: 0;
    line-height: 1;
  }
  .close-btn:hover { color: var(--text); }
  .map-container { height: 400px; width: 100%; background: #111; }
</style>
