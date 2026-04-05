<script lang="ts">
  import 'leaflet/dist/leaflet.css';
  import favicon from '$lib/assets/favicon.svg';
  import type { Snippet } from 'svelte';

  let { children }: { children: Snippet } = $props();
</script>

<svelte:head>
  <link rel="icon" href={favicon} />
  <title>Half the Marathon I Used to Be</title>
  <meta name="description" content="6 years of running data — routes, stats, and progress." />
</svelte:head>

<nav>
  <a href="/" class="logo"><img src="/bannerlogo.png" alt="Half the Marathon I Used to Be" /></a>
  <div class="links">
    <a href="/">Runs</a>
    <a href="/stats">Stats</a>
  </div>
</nav>

{@render children()}

<style>
  :global(*, *::before, *::after) { box-sizing: border-box; margin: 0; padding: 0; }
  :global(:root) {
    --bg: #0f0f0f;
    --surface: #1a1a1a;
    --border: #2a2a2a;
    --text: #e8e8e8;
    --muted: #888;
    --accent: #f97316;
  }
  :global(html, body) {
    background: var(--bg);
    color: var(--text);
    font-family: system-ui, sans-serif;
  }
  :global(a) { color: inherit; text-decoration: none; }

  nav {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1rem 1.5rem;
    border-bottom: 1px solid var(--border);
    position: sticky;
    top: 0;
    background: var(--bg);
    z-index: 10;
  }
  .logo img {
    display: block;
    height: 36px;
    width: auto;
  }
  .links {
    display: flex;
    gap: 1.5rem;
    font-size: 0.9rem;
    color: var(--muted);
  }
  .links a:hover { color: var(--text); }
</style>
