<script lang="ts">
  import type { PageData } from './$types.js';
  let { data }: { data: PageData } = $props();
</script>

<svelte:head>
  <meta http-equiv="refresh" content="30" />
</svelte:head>

<main>
  <h1>System Health</h1>
  <p class="checked">Checked at {data.checkedAt}</p>

  <table>
    <tbody>
      <tr>
        <td class="label">Directus</td>
        <td class:ok={data.directusOk} class:fail={!data.directusOk}>{data.directusOk ? 'UP' : 'DOWN'}</td>
      </tr>
      <tr>
        <td class="label">Webhook listener</td>
        <td class:ok={data.webhookOk} class:fail={!data.webhookOk}>{data.webhookOk ? 'UP' : 'DOWN'}</td>
      </tr>
      <tr>
        <td class="label">Activities</td>
        <td>{data.activityCount}</td>
      </tr>
      <tr>
        <td class="label">Photos</td>
        <td>{data.photoCount}</td>
      </tr>
      <tr>
        <td class="label">Last synced</td>
        <td>{data.latestActivity ? `${data.latestActivity.date.slice(0, 10)} — ${data.latestActivity.name ?? 'Run'}` : '—'}</td>
      </tr>
    </tbody>
  </table>
</main>

<style>
  main { padding: 2rem; max-width: 480px; margin: 0 auto; }
  h1 { font-size: 1.1rem; font-weight: 600; margin-bottom: 0.25rem; }
  .checked { font-size: 0.75rem; color: var(--muted); margin-bottom: 1.5rem; }
  table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
  td { padding: 0.6rem 0.75rem; border-bottom: 1px solid var(--border); }
  .label { color: var(--muted); width: 40%; }
  .ok { color: #22c55e; font-weight: 600; }
  .fail { color: #ef4444; font-weight: 600; }
</style>
