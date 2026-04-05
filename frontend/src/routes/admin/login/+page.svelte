<script lang="ts">
  import { goto } from '$app/navigation';

  let token = $state('');
  let error = $state('');
  let loading = $state(false);

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    error = '';
    loading = true;
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      if (res.ok) {
        await goto('/stats');
      } else {
        error = 'Invalid token';
      }
    } catch {
      error = 'Login failed';
    } finally {
      loading = false;
    }
  }
</script>

<main>
  <form onsubmit={submit}>
    <h1>Admin login</h1>
    <input
      type="password"
      placeholder="Admin token"
      bind:value={token}
      autocomplete="current-password"
    />
    <button type="submit" disabled={loading}>
      {loading ? 'Logging in…' : 'Login'}
    </button>
    {#if error}
      <p class="error">{error}</p>
    {/if}
  </form>
</main>

<style>
  main {
    display: flex;
    justify-content: center;
    padding-top: 6rem;
  }
  form {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    width: 100%;
    max-width: 320px;
  }
  h1 {
    font-size: 1rem;
    font-weight: 600;
    margin-bottom: 0.25rem;
  }
  input {
    background: var(--surface);
    border: 1px solid var(--border);
    color: var(--text);
    padding: 0.5rem 0.75rem;
    font-size: 0.9rem;
    width: 100%;
  }
  input:focus {
    outline: none;
    border-color: var(--accent);
  }
  button {
    background: var(--accent);
    border: none;
    color: #fff;
    cursor: pointer;
    font-size: 0.9rem;
    padding: 0.5rem 1rem;
  }
  button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  .error {
    color: #ef4444;
    font-size: 0.82rem;
  }
</style>
