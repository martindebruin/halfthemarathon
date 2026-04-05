<script lang="ts">
  interface Split {
    split: number;
    elevation_difference: number;
    distance: number;
  }

  let { splits }: { splits: Split[] } = $props();

  const WIDTH = 600;
  const HEIGHT = 120;
  const PAD = { top: 10, right: 10, bottom: 24, left: 36 };

  const chartWidth = $derived(WIDTH - PAD.left - PAD.right);
  const chartHeight = $derived(HEIGHT - PAD.top - PAD.bottom);

  // Build cumulative elevation from splits
  const points = $derived.by(() => {
    if (splits.length === 0) return [];
    const pts: Array<{ x: number; y: number; km: number; elev: number }> = [];
    let cumElev = 0;
    let cumDist = 0;
    pts.push({ x: 0, y: 0, km: 0, elev: 0 });
    for (const s of splits) {
      cumElev += s.elevation_difference;
      cumDist += s.distance / 1000;
      pts.push({ x: cumDist, y: cumElev, km: cumDist, elev: cumElev });
    }
    return pts;
  });

  const minElev = $derived(Math.min(...points.map((p) => p.y)));
  const maxElev = $derived(Math.max(...points.map((p) => p.y)));
  const maxDist = $derived(points.at(-1)?.x ?? 1);
  const elevRange = $derived(Math.max(maxElev - minElev, 10)); // avoid div by 0

  function toSvgX(km: number): number {
    return PAD.left + (km / maxDist) * chartWidth;
  }
  function toSvgY(elev: number): number {
    return PAD.top + chartHeight - ((elev - minElev) / elevRange) * chartHeight;
  }

  const pathD = $derived(
    points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${toSvgX(p.x).toFixed(1)},${toSvgY(p.y).toFixed(1)}`).join(' ')
  );
  const areaD = $derived(
    pathD +
    ` L ${toSvgX(maxDist).toFixed(1)},${(PAD.top + chartHeight).toFixed(1)}` +
    ` L ${PAD.left},${(PAD.top + chartHeight).toFixed(1)} Z`
  );

  let hoveredPoint: { x: number; y: number; km: number; elev: number } | null = $state(null);

  function onMouseMove(e: MouseEvent) {
    const svg = (e.currentTarget as SVGElement).getBoundingClientRect();
    const mouseX = e.clientX - svg.left - PAD.left;
    const kmAtMouse = (mouseX / chartWidth) * maxDist;
    let closest = points[0];
    for (const p of points) {
      if (Math.abs(p.km - kmAtMouse) < Math.abs(closest.km - kmAtMouse)) closest = p;
    }
    hoveredPoint = closest;
  }
</script>

{#if points.length > 1}
  <div class="elevation">
    <div class="title">Elevation</div>
    <svg
      viewBox="0 0 {WIDTH} {HEIGHT}"
      role="img"
      aria-label="Elevation profile"
      onmousemove={onMouseMove}
      onmouseleave={() => hoveredPoint = null}
    >
      <!-- Area fill -->
      <path d={areaD} fill="#f97316" opacity="0.15" />
      <!-- Line -->
      <path d={pathD} fill="none" stroke="#f97316" stroke-width="1.5" />

      <!-- Hover indicator -->
      {#if hoveredPoint}
        <line
          x1={toSvgX(hoveredPoint.x)}
          y1={PAD.top}
          x2={toSvgX(hoveredPoint.x)}
          y2={PAD.top + chartHeight}
          stroke="#f97316"
          stroke-width="1"
          opacity="0.5"
          stroke-dasharray="3,3"
        />
        <circle cx={toSvgX(hoveredPoint.x)} cy={toSvgY(hoveredPoint.y)} r="3" fill="#f97316" />
        <text x={toSvgX(hoveredPoint.x)} y={PAD.top + 10} text-anchor="middle" font-size="9" fill="#f97316">
          {hoveredPoint.km.toFixed(1)}km · {Math.round(hoveredPoint.elev)}m
        </text>
      {/if}

      <!-- Baseline -->
      <line x1={PAD.left} y1={PAD.top + chartHeight} x2={PAD.left + chartWidth} y2={PAD.top + chartHeight} stroke="#333" stroke-width="1" />

      <!-- Y axis label -->
      <text x={PAD.left - 4} y={PAD.top + chartHeight / 2} text-anchor="end" dominant-baseline="middle" font-size="8" fill="#666">
        {Math.round(minElev)}m
      </text>
      <text x={PAD.left - 4} y={PAD.top} text-anchor="end" dominant-baseline="hanging" font-size="8" fill="#666">
        {Math.round(maxElev)}m
      </text>
    </svg>
  </div>
{/if}

<style>
  .elevation { margin-top: 1rem; }
  .title { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--muted); margin-bottom: 0.5rem; }
  svg { width: 100%; display: block; cursor: crosshair; }
</style>
