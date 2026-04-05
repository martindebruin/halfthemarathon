<script lang="ts">
  import type { PageData } from './$types.js';
  import { formatDistance, formatPace, formatDate, formatDuration, polylineToSvgPath, computedSpeed } from '$lib/utils.js';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';

  const DIRECTUS_URL = import.meta.env.VITE_DIRECTUS_PUBLIC_URL ?? '';

  let { data }: { data: PageData } = $props();

  // Derive available years from data
  const years = $derived(
    [...new Set(data.activities.map((a) => new Date(a.date).getFullYear()))].sort((a, b) => b - a)
  );

  // Read filters from URL
  let selectedYear = $state($page.url.searchParams.get('year') ?? 'all');
  let selectedDist = $state($page.url.searchParams.get('dist') ?? 'all');

  // Dist buckets: label → [minM, maxM | null]
  const DIST_BUCKETS: Record<string, [number, number | null]> = {
    '0-5': [0, 5000],
    '5-10': [5000, 10000],
    '10-21': [10000, 21097],
    '21+': [21097, null],
  };

  const filtered = $derived(data.activities.filter((a) => {
    if (selectedYear !== 'all' && new Date(a.date).getFullYear() !== Number(selectedYear)) return false;
    if (selectedDist !== 'all') {
      const [min, max] = DIST_BUCKETS[selectedDist] ?? [0, null];
      const d = a.distance_m ?? 0;
      if (d < min) return false;
      if (max !== null && d >= max) return false;
    }
    return true;
  }));

  function updateFilters() {
    const params = new URLSearchParams();
    if (selectedYear !== 'all') params.set('year', selectedYear);
    if (selectedDist !== 'all') params.set('dist', selectedDist);
    goto(`?${params.toString()}`, { replaceState: true, noScroll: true });
  }
</script>

<main>
  <header>
    <div class="title-row">
      <h1>All runs</h1>
      <p class="count">{filtered.length} of {data.activities.length}</p>
    </div>
    <div class="filters">
      <select bind:value={selectedYear} onchange={updateFilters}>
        <option value="all">All years</option>
        {#each years as y}<option value={y}>{y}</option>{/each}
      </select>
      <select bind:value={selectedDist} onchange={updateFilters}>
        <option value="all">Any distance</option>
        <option value="0-5">0–5 km</option>
        <option value="5-10">5–10 km</option>
        <option value="10-21">10–21 km</option>
        <option value="21+">21+ km</option>
      </select>
    </div>
  </header>

  <div class="grid">
    {#each filtered as activity (activity.id)}
      <a href="/run/{activity.id}" class="card">
        <div class="map">
          {#if activity.photos?.[0]?.directus_file_id}
            <img
              src="{DIRECTUS_URL}/assets/{activity.photos[0].directus_file_id}?width=240&height=144&fit=cover&quality=70"
              alt=""
              loading="lazy"
              class="thumb"
            />
          {:else if activity.summary_polyline}
            <svg viewBox="0 0 200 120" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
              <polyline
                points={polylineToSvgPath(activity.summary_polyline)}
                fill="none"
                stroke="var(--accent)"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          {:else}
            <div class="no-map">no route</div>
          {/if}
        </div>
        <div class="info">
          <time class="date">{formatDate(activity.date)}</time>
          <div class="route">{activity.route_name ?? activity.name ?? 'Run'}</div>
          <div class="stats">
            <span class="stat">{formatDistance(activity.distance_m)}</span>
            <span class="sep">·</span>
            <span class="stat">{formatPace(activity.average_speed ?? computedSpeed(activity.distance_m, activity.moving_time_s))}</span>
            <span class="sep">·</span>
            <span class="stat">{formatDuration(activity.moving_time_s)}</span>
          </div>
          {#if activity.average_heartrate}
            <div class="hr">{Math.round(activity.average_heartrate)} bpm avg</div>
          {/if}
        </div>
      </a>
    {/each}
  </div>
</main>

<style>
  main { padding: 1.5rem; max-width: 1400px; margin: 0 auto; }

  header {
    margin-bottom: 1.5rem;
  }
  .title-row { display: flex; align-items: baseline; gap: 1rem; }
  .filters { display: flex; gap: 0.75rem; margin-top: 0.75rem; flex-wrap: wrap; }
  select {
    background: var(--surface);
    border: 1px solid var(--border);
    color: var(--text);
    padding: 0.35rem 0.6rem;
    font-size: 0.8rem;
    border-radius: 4px;
    cursor: pointer;
  }
  select:hover { border-color: var(--accent); }
  h1 { font-size: 1.25rem; font-weight: 600; }
  .count { color: var(--muted); font-size: 0.85rem; }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: 1px;
    background: var(--border);
    border: 1px solid var(--border);
  }

  .card {
    background: var(--bg);
    display: flex;
    flex-direction: column;
    transition: background 0.15s;
  }
  .card:hover { background: var(--surface); }

  .map {
    width: 100%;
    aspect-ratio: 5 / 3;
    background: #111;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .map svg { width: 100%; height: 100%; }
  .no-map { color: var(--border); font-size: 0.7rem; letter-spacing: 0.1em; text-transform: uppercase; }
  .thumb { width: 100%; height: 100%; object-fit: cover; display: block; }

  .info { padding: 0.75rem; }
  .date { font-size: 0.72rem; color: var(--muted); display: block; margin-bottom: 0.2rem; }
  .route { font-size: 0.85rem; font-weight: 500; margin-bottom: 0.4rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .stats { font-size: 0.78rem; color: var(--muted); }
  .sep { margin: 0 0.25rem; }
  .hr { font-size: 0.72rem; color: var(--muted); margin-top: 0.25rem; }
</style>
