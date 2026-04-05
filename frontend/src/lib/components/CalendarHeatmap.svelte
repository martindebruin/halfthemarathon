<script lang="ts">
  type DayData = { total_km: number; first_activity_id: string };

  let { daily }: { daily: Record<string, DayData> } = $props();

  const CELL = 11;
  const GAP = 2;
  const COLS = 53; // weeks
  const ROWS = 7;  // days (Mon–Sun)
  const LEFT_PAD = 24;
  const TOP_PAD = 16;

  // Build a grid of 53×7 cells starting from the Monday of 52 weeks ago
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Find the Monday of the week 52 weeks ago
  const start = new Date(today);
  start.setDate(start.getDate() - 52 * 7);
  // Align to Monday (getDay: 0=Sun, 1=Mon ... 6=Sat)
  const dayOffset = (start.getDay() + 6) % 7; // Mon=0
  start.setDate(start.getDate() - dayOffset);

  interface Cell {
    date: string;
    col: number;
    row: number;
    total_km: number;
    first_activity_id: string | null;
  }

  const cells: Cell[] = $derived.by(() => {
    const result: Cell[] = [];
    for (let col = 0; col < COLS; col++) {
      for (let row = 0; row < ROWS; row++) {
        const d = new Date(start);
        d.setDate(d.getDate() + col * 7 + row);
        if (d > today) continue;
        const dateStr = d.toISOString().slice(0, 10);
        const data = daily[dateStr];
        result.push({
          date: dateStr,
          col,
          row,
          total_km: data?.total_km ?? 0,
          first_activity_id: data?.first_activity_id ?? null,
        });
      }
    }
    return result;
  });

  const maxKm = $derived(Math.max(...cells.map((c) => c.total_km), 1));

  function cellColor(km: number): string {
    if (km === 0) return '#1c1c1c';
    const t = Math.min(km / maxKm, 1);
    // Scale from dim orange to bright orange
    const alpha = 0.2 + t * 0.8;
    return `rgba(249,115,22,${alpha.toFixed(2)})`;
  }

  const SVG_W = LEFT_PAD + COLS * (CELL + GAP);
  const SVG_H = TOP_PAD + ROWS * (CELL + GAP);

  const MONTH_LABELS = $derived.by(() => {
    const labels: Array<{ label: string; x: number }> = [];
    let lastMonth = -1;
    for (let col = 0; col < COLS; col++) {
      const d = new Date(start);
      d.setDate(d.getDate() + col * 7);
      const m = d.getMonth();
      if (m !== lastMonth) {
        labels.push({ label: d.toLocaleString('en', { month: 'short' }), x: LEFT_PAD + col * (CELL + GAP) });
        lastMonth = m;
      }
    }
    return labels;
  });
</script>

<div class="heatmap">
  <svg viewBox="0 0 {SVG_W} {SVG_H}" role="img" aria-label="Activity calendar">
    {#each MONTH_LABELS as { label, x }}
      <text {x} y="10" font-size="8" fill="#666">{label}</text>
    {/each}

    {#each cells as cell (cell.date)}
      {@const cx = LEFT_PAD + cell.col * (CELL + GAP)}
      {@const cy = TOP_PAD + cell.row * (CELL + GAP)}
      {#if cell.first_activity_id}
        <a href="/run/{cell.first_activity_id}" aria-label="{cell.date}: {cell.total_km.toFixed(1)} km">
          <rect x={cx} y={cy} width={CELL} height={CELL} rx="2" fill={cellColor(cell.total_km)}>
            <title>{cell.date}: {cell.total_km.toFixed(1)} km</title>
          </rect>
        </a>
      {:else}
        <rect x={cx} y={cy} width={CELL} height={CELL} rx="2" fill={cellColor(cell.total_km)} />
      {/if}
    {/each}
  </svg>
</div>

<style>
  .heatmap { overflow-x: auto; }
  svg { min-width: 600px; width: 100%; display: block; }
  a { text-decoration: none; }
  a rect:hover { opacity: 0.75; }
</style>
