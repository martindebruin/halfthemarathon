<script lang="ts">
  import type { ActionData } from './$types.js';

  let { form }: { form: ActionData } = $props();
</script>

<main>
  <form method="POST">
    <h1>Logga in</h1>
    <input
      type="password"
      name="password"
      placeholder="Lösenord"
      autocomplete="current-password"
      required
    />
    <button type="submit">Logga in</button>
    {#if form?.error}
      <p class="error">{form.error}</p>
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
    padding: 0 1rem;
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
    color: #000;
    border: none;
    padding: 0.5rem 0.75rem;
    font-size: 0.9rem;
    font-weight: 600;
    cursor: pointer;
  }
  .error {
    color: #f87171;
    font-size: 0.85rem;
  }
</style>
