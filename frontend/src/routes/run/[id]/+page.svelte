<script lang="ts">
  import type { PageData } from './$types.js';
  import { formatDistance, formatPace, formatDate, formatDuration, formatHeartRate, computedSpeed } from '$lib/utils.js';
  import RunMap from '$lib/components/RunMap.svelte';
  import ElevationProfile from '$lib/components/ElevationProfile.svelte';
  import Lightbox from '$lib/components/Lightbox.svelte';

  let { data }: { data: PageData } = $props();

  const activity = $derived(data.activity);
  const photos = $derived(data.photos);

  const splits: Array<{
    split: number;
    average_speed: number;
    moving_time: number;
    average_heartrate?: number;
    elevation_difference: number;
    distance: number;
  }> = $derived.by(() => {
    if (!activity.splits_metric) return [];
    try { return JSON.parse(activity.splits_metric); } catch { return []; }
  });

  const DIRECTUS_URL = import.meta.env.VITE_DIRECTUS_PUBLIC_URL ?? '';

  let showRouteHistory = $state(false);

  const thisRouteRun = $derived(
    data.routeContext?.runs.find((r) => r.id === data.activity.id) ?? null
  );

  const routeRank = $derived.by(() => {
    if (!data.routeContext || !thisRouteRun?.time_s) return null;
    const timed = [...data.routeContext.runs.filter((r) => r.time_s != null)].sort(
      (a, b) => a.time_s! - b.time_s!
    );
    return timed.findIndex((r) => r.id === data.activity.id) + 1;
  });

  function fmtPace(s_km: number): string {
    const m = Math.floor(s_km / 60);
    const s = Math.round(s_km % 60);
    return `${m}:${String(s).padStart(2, '0')} /km`;
  }
</script>

<main>
  <div class="back"><a href="/">&larr; All runs</a></div>

  <header>
    <h1>{activity.name ?? activity.route_name ?? 'Run'}</h1>
    <time class="date">{formatDate(activity.date)}</time>
  </header>

  <div class="layout">
    <div class="map-col">
      {#if activity.summary_polyline}
        <RunMap
          summaryPolyline={activity.summary_polyline}
          startLat={activity.start_lat}
          startLng={activity.start_lng}
        />
      {/if}

      <ElevationProfile {splits} />

      <Lightbox {photos} directusUrl={DIRECTUS_URL} />
    </div>

    <div class="stats-col">
      <div class="stat-grid">
        <div class="stat-item">
          <div class="label">Distance</div>
          <div class="value">{formatDistance(activity.distance_m)}</div>
        </div>
        <div class="stat-item">
          <div class="label">Avg pace</div>
          <div class="value">{formatPace(activity.average_speed ?? computedSpeed(activity.distance_m, activity.moving_time_s))}</div>
        </div>
        <div class="stat-item">
          <div class="label">Time</div>
          <div class="value">{formatDuration(activity.moving_time_s)}</div>
        </div>
        <div class="stat-item">
          <div class="label">Elevation</div>
          <div class="value">{activity.total_elevation_gain != null ? Math.round(activity.total_elevation_gain) + ' m' : '—'}</div>
        </div>
        <div class="stat-item">
          <div class="label">Avg HR</div>
          <div class="value">{formatHeartRate(activity.average_heartrate)}</div>
        </div>
        <div class="stat-item">
          <div class="label">Max HR</div>
          <div class="value">{formatHeartRate(activity.max_heartrate)}</div>
        </div>
        {#if activity.calories}
          <div class="stat-item">
            <div class="label">Calories</div>
            <div class="value">{Math.round(activity.calories)} kcal</div>
          </div>
        {/if}
        {#if activity.suffer_score}
          <div class="stat-item">
            <div class="label">Suffer score</div>
            <div class="value">{activity.suffer_score}</div>
          </div>
        {/if}
      </div>

      {#if splits.length > 0}
        <div class="splits">
          <h2>Splits</h2>
          <table>
            <thead>
              <tr>
                <th>KM</th>
                <th>Pace</th>
                <th>Time</th>
                {#if splits[0]?.average_heartrate}<th>HR</th>{/if}
              </tr>
            </thead>
            <tbody>
              {#each splits as split (split.split)}
                <tr>
                  <td>{split.split}</td>
                  <td>{formatPace(split.average_speed)}</td>
                  <td>{formatDuration(split.moving_time)}</td>
                  {#if split.average_heartrate}<td>{Math.round(split.average_heartrate)}</td>{/if}
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}

      {#if activity.notes}
        <div class="notes">
          <h2>Notes</h2>
          <p>{activity.notes}</p>
        </div>
      {/if}
      {#if data.routeContext}
        {@const rc = data.routeContext}
        <div class="route-context">
          <h2>Route</h2>
          <div class="route-headline">
            <a href="/stats" class="route-name-link">{rc.display_name}</a>
            {#if routeRank != null}
              <span class="route-rank">#{routeRank} of {rc.runs.filter((r) => r.time_s != null).length} timed runs</span>
            {/if}
          </div>
          <div class="route-compare">
            {#if thisRouteRun?.time_s != null}
              <div class="compare-row">
                <span class="compare-label">Time</span>
                <span>{formatDuration(thisRouteRun.time_s)}</span>
                {#if rc.best_time_s != null && rc.best_time_s !== thisRouteRun.time_s}
                  <span class="muted">best {formatDuration(rc.best_time_s)}</span>
                {/if}
              </div>
            {/if}
            {#if thisRouteRun?.pace_s_km != null}
              <div class="compare-row">
                <span class="compare-label">Pace</span>
                <span>{fmtPace(thisRouteRun.pace_s_km)}</span>
                {#if rc.best_pace_s_km != null && rc.best_pace_s_km !== thisRouteRun.pace_s_km}
                  <span class="muted">best {fmtPace(rc.best_pace_s_km)}</span>
                {/if}
              </div>
            {/if}
          </div>
          <button class="toggle-history-btn" onclick={() => showRouteHistory = !showRouteHistory}>
            {showRouteHistory ? 'Hide' : `All ${rc.run_count} runs`} {showRouteHistory ? '▴' : '▾'}
          </button>
          {#if showRouteHistory}
            <table class="route-history">
              <thead>
                <tr><th>Date</th><th>Time</th><th>Pace</th></tr>
              </thead>
              <tbody>
                {#each rc.runs as run (run.id)}
                  <tr class:current-run={run.id === data.activity.id}>
                    <td><a href="/run/{run.id}">{run.date.slice(0, 10)}</a></td>
                    <td>{run.time_s != null ? formatDuration(run.time_s) : '—'}</td>
                    <td>{run.pace_s_km != null ? fmtPace(run.pace_s_km) : '—'}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          {/if}
        </div>
      {/if}
    </div>
  </div>
</main>

<style>
  main { padding: 1.5rem; max-width: 1200px; margin: 0 auto; }

  .back { margin-bottom: 1rem; font-size: 0.85rem; color: var(--muted); }
  .back a:hover { color: var(--text); }

  header { margin-bottom: 1.5rem; }
  h1 { font-size: 1.5rem; font-weight: 600; margin-bottom: 0.25rem; }
  .date { font-size: 0.85rem; color: var(--muted); }

  .layout {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 2rem;
  }
  @media (max-width: 768px) {
    .layout { grid-template-columns: 1fr; }
  }

.stat-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1px;
    background: var(--border);
    border: 1px solid var(--border);
    margin-bottom: 1.5rem;
  }
  .stat-item { background: var(--bg); padding: 0.75rem; }
  .label { font-size: 0.72rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.25rem; }
  .value { font-size: 1.1rem; font-weight: 500; }

  .splits h2, .notes h2 { font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--muted); margin-bottom: 0.75rem; }

  table { width: 100%; border-collapse: collapse; font-size: 0.85rem; margin-bottom: 1.5rem; }
  th { text-align: left; padding: 0.4rem 0.5rem; color: var(--muted); font-weight: 400; border-bottom: 1px solid var(--border); }
  td { padding: 0.4rem 0.5rem; border-bottom: 1px solid var(--border); }
  tr:hover td { background: var(--surface); }

  .notes p { font-size: 0.9rem; color: var(--muted); line-height: 1.6; }

  .route-context { margin-top: 1.5rem; }
  .route-context h2 { font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--muted); margin-bottom: 0.75rem; }
  .route-headline { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.5rem; flex-wrap: wrap; }
  .route-name-link { font-weight: 500; color: var(--text); }
  .route-name-link:hover { color: var(--accent); }
  .route-rank { font-size: 0.8rem; color: var(--muted); }
  .route-compare { margin-bottom: 0.75rem; display: flex; flex-direction: column; gap: 0.25rem; }
  .compare-row { display: flex; align-items: center; gap: 0.5rem; font-size: 0.875rem; }
  .compare-label { font-size: 0.72rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; width: 3rem; flex-shrink: 0; }
  .muted { color: var(--muted); }
  .toggle-history-btn {
    background: none;
    border: 1px solid var(--border);
    color: var(--muted);
    cursor: pointer;
    font-size: 0.78rem;
    padding: 0.25rem 0.6rem;
    margin-bottom: 0.75rem;
  }
  .toggle-history-btn:hover { border-color: var(--accent); color: var(--accent); }
  .route-history { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
  .route-history th { text-align: left; padding: 0.4rem 0.5rem; color: var(--muted); font-weight: 400; border-bottom: 1px solid var(--border); }
  .route-history td { padding: 0.4rem 0.5rem; border-bottom: 1px solid var(--border); }
  .route-history tr.current-run td { color: var(--accent); }
  .route-history a { color: inherit; }
  .route-history a:hover { text-decoration: underline; }
</style>
