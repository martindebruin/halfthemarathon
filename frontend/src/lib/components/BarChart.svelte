<script lang="ts">
  import { onMount } from 'svelte';

  let {
    labels,
    datasets,
    yLabel = '',
  }: {
    labels: string[];
    datasets: Array<{ label: string; data: number[]; color: string }>;
    yLabel?: string;
  } = $props();

  let canvas: HTMLCanvasElement;

  onMount(async () => {
    const { Chart, registerables } = await import('chart.js');
    Chart.register(...registerables);
    const chart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: datasets.map((d) => ({
          label: d.label,
          data: d.data,
          backgroundColor: d.color,
          borderRadius: 3,
        })),
      },
      options: {
        responsive: true,
        plugins: {
          legend: { labels: { color: '#8b949e', font: { size: 11 } } },
        },
        scales: {
          x: { ticks: { color: '#8b949e' }, grid: { color: '#21262d' } },
          y: { ticks: { color: '#8b949e' }, grid: { color: '#21262d' }, title: { display: !!yLabel, text: yLabel, color: '#8b949e' } },
        },
      },
    });
    return () => chart.destroy();
  });
</script>

<canvas bind:this={canvas}></canvas>
