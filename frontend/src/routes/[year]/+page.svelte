<script lang="ts">
  import type { PageData } from './$types.js';
  import { formatDistance, formatPace, formatDate, formatDuration, polylineToSvgPath, computedSpeed } from '$lib/utils.js';

  let { data }: { data: PageData } = $props();

  const totalHours = $derived(Math.round(data.totalTimS / 3600));
</script>

<main>
  <div class="back"><a href="/stats">&larr; Stats</a></div>

  <header>
    <div class="year-nav">
      {#if data.prevYear}<a href="/{data.prevYear}" class="nav-arrow">&#8249;</a>{:else}<span class="nav-arrow disabled">&#8249;</span>{/if}
      <h1>{data.year}</h1>
      {#if data.nextYear}<a href="/{data.nextYear}" class="nav-arrow">&#8250;</a>{:else}<span class="nav-arrow disabled">&#8250;</span>{/if}
    </div>
    <p class="sub">{data.activities.length} runs</p>
  </header>

  <div class="summary">
    <div class="stat-item"><div class="label">Distance</div><div class="value">{formatDistance(data.totalDistM)}</div></div>
    <div class="stat-item"><div class="label">Time</div><div class="value">{totalHours} h</div></div>
    <div class="stat-item"><div class="label">Elevation</div><div class="value">{Math.round(data.totalElev)} m</div></div>
  </div>

  {#if data.longest}
    <div class="highlights">
      <div class="highlight">
        <div class="label">Longest run</div>
        <a href="/run/{data.longest.id}" class="hl-link">{formatDistance(data.longest.distance_m)} — {formatDate(data.longest.date)}</a>
      </div>
      {#if data.fastest && data.fastest.id !== data.longest.id}
        <div class="highlight">
          <div class="label">Fastest pace</div>
          <a href="/run/{data.fastest.id}" class="hl-link">{formatPace(data.fastest.average_speed ?? computedSpeed(data.fastest.distance_m, data.fastest.moving_time_s))} — {formatDate(data.fastest.date)}</a>
        </div>
      {/if}
    </div>
  {/if}

  <div class="grid">
    {#each data.activities as activity (activity.id)}
      <a href="/run/{activity.id}" class="card">
        <div class="map">
          {#if activity.summary_polyline}
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
          <div class="stats">
            <span>{formatDistance(activity.distance_m)}</span>
            <span class="sep">·</span>
            <span>{formatPace(activity.average_speed ?? computedSpeed(activity.distance_m, activity.moving_time_s))}</span>
          </div>
        </div>
      </a>
    {/each}
  </div>
</main>

<style>
  main { padding: 1.5rem; max-width: 1400px; margin: 0 auto; }
  .back { margin-bottom: 1rem; font-size: 0.85rem; color: var(--muted); }
  .year-nav { display: flex; align-items: center; gap: 1rem; }
  h1 { font-size: 2rem; font-weight: 700; }
  .nav-arrow { font-size: 1.8rem; color: var(--muted); line-height: 1; }
  .nav-arrow:not(.disabled):hover { color: var(--accent); }
  .nav-arrow.disabled { opacity: 0.2; cursor: default; }
  .sub { color: var(--muted); font-size: 0.85rem; margin-top: 0.25rem; margin-bottom: 1.5rem; }
  .summary { display: flex; gap: 1px; background: var(--border); border: 1px solid var(--border); margin-bottom: 1.5rem; max-width: 480px; }
  .stat-item { background: var(--bg); padding: 0.75rem 1.25rem; flex: 1; }
  .label { font-size: 0.72rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.2rem; }
  .value { font-size: 1.2rem; font-weight: 500; }
  .highlights { display: flex; flex-direction: column; gap: 0.5rem; margin-bottom: 1.5rem; }
  .highlight .label { font-size: 0.72rem; color: var(--muted); text-transform: uppercase; margin-bottom: 0.1rem; }
  .hl-link { font-size: 0.9rem; color: var(--accent); }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 1px; background: var(--border); border: 1px solid var(--border); }
  .card { background: var(--bg); display: flex; flex-direction: column; transition: background 0.15s; }
  .card:hover { background: var(--surface); }
  .map { aspect-ratio: 5/3; background: #111; overflow: hidden; display: flex; align-items: center; justify-content: center; }
  .map svg { width: 100%; height: 100%; }
  .no-map { color: var(--border); font-size: 0.7rem; text-transform: uppercase; }
  .info { padding: 0.5rem 0.65rem; }
  .date { font-size: 0.7rem; color: var(--muted); display: block; margin-bottom: 0.15rem; }
  .stats { font-size: 0.78rem; color: var(--muted); }
  .sep { margin: 0 0.2rem; }
</style>
