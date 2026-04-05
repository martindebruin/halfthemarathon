<script lang="ts">
  let {
    photos,
    directusUrl,
  }: {
    photos: Array<{ id: string; directus_file_id: string | null; caption: string | null }>;
    directusUrl: string;
  } = $props();

  const visible = $derived(photos.filter((p) => p.directus_file_id));

  let openIndex: number | null = $state(null);

  function open(i: number) { openIndex = i; }
  function close() { openIndex = null; }
  function prev() { if (openIndex !== null && openIndex > 0) openIndex--; }
  function next() { if (openIndex !== null && openIndex < visible.length - 1) openIndex++; }

  function onKeydown(e: KeyboardEvent) {
    if (openIndex === null) return;
    if (e.key === 'Escape') close();
    if (e.key === 'ArrowLeft') prev();
    if (e.key === 'ArrowRight') next();
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#if visible.length > 0}
  <div class="gallery">
    {#each visible as photo, i (photo.id)}
      <button class="thumb-btn" onclick={() => open(i)} aria-label={photo.caption ?? `Photo ${i + 1}`}>
        <img
          src="{directusUrl}/assets/{photo.directus_file_id}?width=200&height=150&fit=cover&quality=70"
          alt={photo.caption ?? ''}
          loading="lazy"
          class="thumb"
        />
      </button>
    {/each}
  </div>
{/if}

{#if openIndex !== null}
  {@const photo = visible[openIndex]}
  <div
    class="overlay"
    role="dialog"
    aria-modal="true"
    aria-label="Photo viewer"
    onclick={close}
  >
    <div class="overlay-inner" onclick={(e) => e.stopPropagation()}>
      <button class="close-btn" onclick={close} aria-label="Close">&#215;</button>

      {#if openIndex > 0}
        <button class="arrow arrow-left" onclick={prev} aria-label="Previous">&#8249;</button>
      {/if}

      <img
        src="{directusUrl}/assets/{photo.directus_file_id}?width=1200&quality=90"
        alt={photo.caption ?? ''}
        class="full-img"
      />

      {#if openIndex < visible.length - 1}
        <button class="arrow arrow-right" onclick={next} aria-label="Next">&#8250;</button>
      {/if}

      {#if photo.caption}
        <p class="caption">{photo.caption}</p>
      {/if}
    </div>
  </div>
{/if}

<style>
  .gallery { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 1rem; }
  .thumb-btn { padding: 0; border: none; background: none; cursor: pointer; }
  .thumb { width: 100px; height: 75px; object-fit: cover; display: block; border: 1px solid var(--border); }
  .thumb:hover { opacity: 0.85; }

  .overlay {
    position: fixed; inset: 0; background: rgba(0,0,0,0.92);
    display: flex; align-items: center; justify-content: center;
    z-index: 1000;
  }
  .overlay-inner { position: relative; max-width: 90vw; max-height: 90vh; }
  .full-img { max-width: 90vw; max-height: 85vh; object-fit: contain; display: block; }
  .close-btn {
    position: absolute; top: -2rem; right: 0;
    background: none; border: none; color: #fff; font-size: 1.5rem;
    cursor: pointer; line-height: 1;
  }
  .arrow {
    position: absolute; top: 50%; transform: translateY(-50%);
    background: rgba(0,0,0,0.5); border: none; color: #fff;
    font-size: 2rem; cursor: pointer; padding: 0.5rem 0.75rem; line-height: 1;
    border-radius: 4px;
  }
  .arrow-left { left: -3.5rem; }
  .arrow-right { right: -3.5rem; }
  .caption { color: #999; font-size: 0.85rem; text-align: center; margin-top: 0.5rem; }
</style>
