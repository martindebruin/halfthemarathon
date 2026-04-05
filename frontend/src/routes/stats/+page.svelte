<script lang="ts">
  import type { PageData } from './$types.js';
  import { formatDistance, formatPace, formatDate, formatDuration } from '$lib/utils.js';
  import { invalidateAll } from '$app/navigation';
  import CalendarHeatmap from '$lib/components/CalendarHeatmap.svelte';
  import BarChart from '$lib/components/BarChart.svelte';
  import LineChart from '$lib/components/LineChart.svelte';
  import RouteMapModal from '$lib/components/RouteMapModal.svelte';

  let { data }: { data: PageData } = $props();

  const weekly = $derived(data.weekly);
  const records = $derived(data.records);

  // SVG chart for weekly km
  const chartWidth = 800;
  const chartHeight = 120;
  const padding = { top: 8, right: 8, bottom: 24, left: 40 };

  const recentWeeks = $derived(weekly.slice(0, 52).reverse());
  const maxDist = $derived(Math.max(...recentWeeks.map((w) => w.total_dist_m / 1000), 1));
  const barWidth = $derived(recentWeeks.length > 0
    ? ((chartWidth - padding.left - padding.right) / recentWeeks.length) - 1
    : 10);
  const totalKm = $derived(weekly.reduce((sum, w) => sum + (w.total_dist_m ?? 0), 0) / 1000);
  const totalRuns = $derived(weekly.reduce((sum, w) => sum + (w.run_count ?? 0), 0));

  function barX(i: number): number {
    const innerWidth = chartWidth - padding.left - padding.right;
    return padding.left + i * (innerWidth / recentWeeks.length);
  }

  function barHeight(distKm: number): number {
    const innerHeight = chartHeight - padding.top - padding.bottom;
    return (distKm / maxDist) * innerHeight;
  }

  function barY(distKm: number): number {
    return chartHeight - padding.bottom - barHeight(distKm);
  }

  function fmtPace(s_km: number): string {
    const m = Math.floor(s_km / 60);
    const s = Math.round(s_km % 60);
    return `${m}:${String(s).padStart(2, '0')} /km`;
  }

  let editingKey: string | null = $state(null);
  let editingValue: string = $state('');
  let editInputEl: HTMLInputElement | undefined = $state(undefined);
  let previewRoute: (typeof data.routes)[0] | null = $state(null);

  $effect(() => {
    if (editInputEl) editInputEl.focus();
  });

  function startEdit(cluster_key: string, current_name: string) {
    editingKey = cluster_key;
    editingValue = current_name;
  }

  async function commitEdit(cluster_key: string) {
    if (editingKey !== cluster_key) return;
    if (!editingValue.trim()) {
      editingKey = null;
      return;
    }
    editingKey = null;
    try {
      await fetch('/api/routes/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cluster_key, display_name: editingValue.trim() }),
      });
    } catch {
      // silent failure
    }
    await invalidateAll();
  }

  function handleKeydown(e: KeyboardEvent, cluster_key: string) {
    if (e.key === 'Enter') commitEdit(cluster_key);
    if (e.key === 'Escape') editingKey = null;
  }
</script>

<main>
  <h1>Stats</h1>

  <section class="summary">
    <div class="stat-item">
      <div class="label">Total distance</div>
      <div class="value">{totalKm.toFixed(0)} km</div>
    </div>
    <div class="stat-item">
      <div class="label">Total runs</div>
      <div class="value">{totalRuns}</div>
    </div>
    <div class="stat-item">
      <div class="label">Avg weekly km</div>
      <div class="value">{weekly.length > 0 ? (totalKm / weekly.length).toFixed(1) : '—'} km</div>
    </div>
  </section>

  <section class="section">
    <h2>Activity calendar</h2>
    <CalendarHeatmap daily={data.daily} />
  </section>

  <section class="chart-section">
    <h2>Weekly distance (last 52 weeks)</h2>
    {#if recentWeeks.length > 0}
      <svg viewBox="0 0 {chartWidth} {chartHeight}" class="chart" aria-label="Weekly distance chart">
        {#each recentWeeks as week, i (i)}
          {@const distKm = week.total_dist_m / 1000}
          {@const h = barHeight(distKm)}
          {#if h > 0}
            <rect
              x={barX(i)}
              y={barY(distKm)}
              width={barWidth}
              height={h}
              fill="var(--accent)"
              opacity="0.8"
            />
          {/if}
        {/each}
        <line
          x1={padding.left} y1={chartHeight - padding.bottom}
          x2={chartWidth - padding.right} y2={chartHeight - padding.bottom}
          stroke="var(--border)" stroke-width="1"
        />
      </svg>
    {:else}
      <p class="empty">No weekly data yet.</p>
    {/if}
  </section>

  <section class="section">
    <h2>By year</h2>
    <div class="year-links">
      {#each data.availableYears as y}
        <a href="/{y}" class="year-chip">{y}</a>
      {/each}
    </div>
  </section>

  <section class="section">
    <h2>Lifetime totals</h2>
    <div class="milestone-grid">
      {#each data.milestones as m}
        <div class="milestone">
          <div class="label">{m.label}</div>
          <div class="value">{m.value.toLocaleString()}</div>
          <div class="fun">{m.fun}</div>
        </div>
      {/each}
    </div>
  </section>

  <section class="section">
    <h2>Running streaks</h2>
    <div class="streak-row">
      <div class="milestone"><div class="label">Longest streak</div><div class="value">{data.streaks.longest} days</div></div>
      <div class="milestone"><div class="label">Current streak</div><div class="value">{data.streaks.current} days</div></div>
    </div>
  </section>

  <section class="section">
    <h2>Year over year</h2>
    <BarChart
      labels={data.yoy.map((y) => String(y.year))}
      datasets={[
        { label: 'Distance (km)', data: data.yoy.map((y) => y.dist_km), color: '#f97316' },
        { label: 'Runs', data: data.yoy.map((y) => y.runs), color: '#3b82f6' },
      ]}
      yLabel="km / runs"
    />
  </section>

  <section class="section">
    <h2>Pace trends</h2>
    <LineChart
      labels={data.paceTrends.map((p) => p.month)}
      datasets={[{ label: 'Avg pace', data: data.paceTrends.map((p) => p.avg_s_km), color: '#f97316' }]}
      yLabel="pace (s/km)"
      yFormat={fmtPace}
    />
  </section>

  <section class="section">
    <h2>Personal bests</h2>
    <table class="pb-table">
      <thead><tr><th>Distance</th><th>Time</th><th>Pace</th><th>Date</th></tr></thead>
      <tbody>
        {#each [['5k','5K'],['10k','10K'],['half_marathon','Half marathon'],['marathon','Marathon'],['1k','1K'],['1mile','1 mile']] as [key, label]}
          {@const pb = data.personalBests[key]}
          <tr>
            <td>{label}</td>
            {#if pb}
              <td><a href="/run/{pb.activity_id}">{formatDuration(pb.elapsed_time)}</a></td>
              <td>{fmtPace(pb.elapsed_time / (key === '5k' ? 5 : key === '10k' ? 10 : key === 'half_marathon' ? 21.097 : key === 'marathon' ? 42.195 : key === '1k' ? 1 : 1.609))}</td>
              <td>{pb.date.slice(0, 10)}</td>
            {:else}
              <td colspan="3" class="muted">—</td>
            {/if}
          </tr>
        {/each}
      </tbody>
    </table>
  </section>

  <section class="records">
    <h2>Personal records</h2>
    <div class="record-grid">
      {#if records.longestRun}
        <div class="record-card">
          <div class="record-label">Longest run</div>
          <div class="record-value">{formatDistance(records.longestRun.distance_m)}</div>
          <div class="record-meta">{formatDate(records.longestRun.date)} · {records.longestRun.route_name ?? records.longestRun.name ?? ''}</div>
          <a href="/run/{records.longestRun.id}" class="record-link">View run &rarr;</a>
        </div>
      {/if}

      {#if records.mostElevation}
        <div class="record-card">
          <div class="record-label">Most elevation</div>
          <div class="record-value">{Math.round(records.mostElevation.total_elevation_gain ?? 0)} m</div>
          <div class="record-meta">{formatDate(records.mostElevation.date)} · {formatDistance(records.mostElevation.distance_m)}</div>
          <a href="/run/{records.mostElevation.id}" class="record-link">View run &rarr;</a>
        </div>
      {/if}

      {#if records.fastestPaceActivity}
        <div class="record-card">
          <div class="record-label">Fastest pace (5km+)</div>
          <div class="record-value">{formatPace(records.fastestPaceActivity.average_speed)}</div>
          <div class="record-meta">{formatDate(records.fastestPaceActivity.date)} · {formatDistance(records.fastestPaceActivity.distance_m)}</div>
          <a href="/run/{records.fastestPaceActivity.id}" class="record-link">View run &rarr;</a>
        </div>
      {/if}
    </div>
  </section>

  <section class="section">
    <h2>Routes</h2>
    {#if data.routes.length > 0}
      <table class="pb-table">
        <thead>
          <tr>
            <th>Route</th>
            <th>Runs</th>
            <th>Best time</th>
            <th>Best pace</th>
          </tr>
        </thead>
        <tbody>
          {#each data.routes as route (route.cluster_key)}
            <tr>
              <td class="route-name-cell">
                {#if editingKey === route.cluster_key}
                  <input
                    class="route-edit"
                    type="text"
                    bind:value={editingValue}
                    bind:this={editInputEl}
                    onblur={() => commitEdit(route.cluster_key)}
                    onkeydown={(e) => handleKeydown(e, route.cluster_key)}
                  />
                {:else}
                  <button class="route-name-btn" onclick={() => startEdit(route.cluster_key, route.display_name)}>
                    {route.display_name}
                  </button>
                  {#if route.sample_polyline}
                    <button class="map-btn" onclick={() => previewRoute = route}>Map</button>
                  {/if}
                {/if}
              </td>
              <td class:muted={route.run_count === 1}>{route.run_count}</td>
              <td>{route.best_time_s != null ? formatDuration(route.best_time_s) : '—'}</td>
              <td>{route.best_pace_s_km != null ? fmtPace(route.best_pace_s_km) : '—'}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {:else}
      <p class="empty">No route data yet.</p>
    {/if}
  </section>

{#if previewRoute?.sample_polyline}
  <RouteMapModal
    polyline={previewRoute.sample_polyline}
    title={previewRoute.display_name}
    onclose={() => previewRoute = null}
  />
{/if}
</main>

<style>
  main { padding: 1.5rem; max-width: 1000px; margin: 0 auto; }
  h1 { font-size: 1.25rem; font-weight: 600; margin-bottom: 1.5rem; }
  h2 { font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--muted); margin-bottom: 1rem; }

  .summary {
    display: flex;
    gap: 1px;
    background: var(--border);
    border: 1px solid var(--border);
    margin-bottom: 2rem;
  }
  .stat-item { background: var(--bg); padding: 1rem; flex: 1; }
  .label { font-size: 0.72rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.25rem; }
  .value { font-size: 1.5rem; font-weight: 600; }

  .section { margin-bottom: 2.5rem; }
  .section h2 { font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--muted); margin-bottom: 1rem; }
  .chart-section { margin-bottom: 2rem; }
  .chart { width: 100%; display: block; }
  .empty { color: var(--muted); font-size: 0.85rem; }

  .records { margin-bottom: 2rem; }
  .record-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: 1px;
    background: var(--border);
    border: 1px solid var(--border);
  }
  .record-card { background: var(--bg); padding: 1rem; }
  .record-label { font-size: 0.72rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.25rem; }
  .record-value { font-size: 1.75rem; font-weight: 700; color: var(--accent); margin-bottom: 0.25rem; }
  .record-meta { font-size: 0.78rem; color: var(--muted); margin-bottom: 0.5rem; }
  .record-link { font-size: 0.78rem; color: var(--accent); }
  .record-link:hover { text-decoration: underline; }
  .year-links { display: flex; flex-wrap: wrap; gap: 0.5rem; }
  .year-chip { font-size: 0.85rem; padding: 0.3rem 0.8rem; border: 1px solid var(--border); border-radius: 2rem; color: var(--muted); }
  .year-chip:hover { border-color: var(--accent); color: var(--accent); }
  .milestone-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 1px; background: var(--border); border: 1px solid var(--border); }
  .milestone { background: var(--bg); padding: 1rem; }
  .fun { font-size: 0.75rem; color: var(--muted); margin-top: 0.25rem; }
  .streak-row { display: flex; gap: 1px; background: var(--border); border: 1px solid var(--border); max-width: 360px; }
  .pb-table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
  .pb-table th { text-align: left; padding: 0.5rem 0.75rem; color: var(--muted); font-weight: 400; border-bottom: 1px solid var(--border); }
  .pb-table td { padding: 0.5rem 0.75rem; border-bottom: 1px solid var(--border); }
  .pb-table a { color: var(--accent); }
  .muted { color: var(--muted); }
  .route-name-btn {
    background: none;
    border: none;
    color: var(--text);
    cursor: pointer;
    font-size: inherit;
    padding: 0;
    text-align: left;
  }
  .route-name-btn:hover { color: var(--accent); }
  .route-edit {
    background: var(--surface);
    border: 1px solid var(--accent);
    color: var(--text);
    font-size: inherit;
    padding: 0.1rem 0.3rem;
    width: 100%;
  }
  .route-name-cell { display: flex; align-items: center; gap: 0.5rem; }
  .map-btn {
    background: none;
    border: 1px solid var(--border);
    color: var(--muted);
    cursor: pointer;
    font-size: 0.7rem;
    padding: 0.1rem 0.4rem;
    flex-shrink: 0;
  }
  .map-btn:hover { border-color: var(--accent); color: var(--accent); }
</style>
