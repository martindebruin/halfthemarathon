<script lang="ts">
  import { onMount } from 'svelte';

  let {
    labels,
    datasets,
    yLabel = '',
    yFormat,
  }: {
    labels: string[];
    datasets: Array<{ label: string; data: number[]; color: string }>;
    yLabel?: string;
    yFormat?: (v: number) => string;
  } = $props();

  let canvas: HTMLCanvasElement;

  onMount(async () => {
    const { Chart, registerables } = await import('chart.js');
    Chart.register(...registerables);
    const chart = new Chart(canvas, {
      type: 'line',
      data: {
        labels,
        datasets: datasets.map((d) => ({
          label: d.label,
          data: d.data,
          borderColor: d.color,
          backgroundColor: d.color + '22',
          tension: 0.3,
          pointRadius: 2,
          fill: false,
        })),
      },
      options: {
        responsive: true,
        plugins: {
          legend: { labels: { color: '#8b949e', font: { size: 11 } } },
          tooltip: {
            callbacks: yFormat ? { label: (ctx) => yFormat(ctx.parsed.y) } : {},
          },
        },
        scales: {
          x: { ticks: { color: '#8b949e', maxTicksLimit: 12 }, grid: { color: '#21262d' } },
          y: {
            ticks: { color: '#8b949e', callback: yFormat ? (v) => yFormat(v as number) : undefined },
            grid: { color: '#21262d' },
            title: { display: !!yLabel, text: yLabel, color: '#8b949e' },
          },
        },
      },
    });
    return () => chart.destroy();
  });
</script>

<canvas bind:this={canvas}></canvas>
