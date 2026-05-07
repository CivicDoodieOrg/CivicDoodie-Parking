<script lang="ts">
  import { onLinkClick } from "$lib/router.svelte";
  import type { DoodieListItem } from "$lib/types";

  let { townSlug, doodie }: { townSlug: string; doodie: DoodieListItem } = $props();

  let href = $derived(`/town/${townSlug}/d/${doodie.slug}`);

  function shortTime(iso: string): string {
    try {
      const ms = Date.now() - new Date(iso.replace(" ", "T") + "Z").getTime();
      const sec = Math.floor(ms / 1000);
      if (sec < 60) return `${sec}s ago`;
      const min = Math.floor(sec / 60);
      if (min < 60) return `${min}m ago`;
      const hr = Math.floor(min / 60);
      if (hr < 24) return `${hr}h ago`;
      const day = Math.floor(hr / 24);
      if (day < 30) return `${day}d ago`;
      return new Date(iso).toLocaleDateString();
    } catch {
      return iso;
    }
  }

  let typeLabel = $derived(
    doodie.type === "enforcement"
      ? "Enforcement"
      : doodie.type === "garage"
        ? "Garage"
        : "Meter"
  );
</script>

<a class="card" {href} onclick={onLinkClick(href)}>
  {#if doodie.first_image_url}
    <img class="thumb" src={doodie.first_image_url} alt="" loading="lazy" />
  {:else}
    <div class="thumb thumb-placeholder">{typeLabel[0]}</div>
  {/if}

  <div class="body">
    <div class="row">
      <span class="badge badge-{doodie.type}">{typeLabel}</span>
      {#if doodie.disability_related}
        <span class="badge badge-disability">Disability</span>
      {/if}
    </div>

    <p class="desc">{doodie.description}</p>

    <div class="meta">
      <span class="reporter">{doodie.reporter.screen_name ?? "(deleted)"}</span>
      <span class="dot">·</span>
      <span class="when">{shortTime(doodie.created_at)}</span>
      <span class="dot">·</span>
      <span class="votes" title="upvotes / downvotes">
        ▲ {doodie.upvotes_count} ▼ {doodie.downvotes_count}
      </span>
      <span class="dot">·</span>
      <span class="comments">{doodie.comments_count} comments</span>
      {#if doodie.image_count > 1}
        <span class="dot">·</span>
        <span class="images">{doodie.image_count} images</span>
      {/if}
    </div>
  </div>
</a>

<style>
  .card {
    display: grid;
    grid-template-columns: 80px 1fr;
    gap: 1rem;
    padding: 1rem;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text-primary);
    transition: border-color 0.15s, background 0.15s;
  }
  .card:hover {
    border-color: var(--border-hover);
    background: var(--bg-tertiary);
    text-decoration: none;
  }
  .thumb {
    width: 80px;
    height: 80px;
    border-radius: 4px;
    object-fit: cover;
    background: var(--bg-tertiary);
  }
  .thumb-placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
    font-size: 1.5rem;
    font-weight: 600;
  }
  .body {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    min-width: 0;
  }
  .row {
    display: flex;
    gap: 0.4rem;
    flex-wrap: wrap;
  }
  .badge {
    display: inline-block;
    padding: 0.15rem 0.5rem;
    border-radius: 999px;
    font-size: 0.75rem;
    font-weight: 500;
    background: var(--bg-tertiary);
    color: var(--text-secondary);
    border: 1px solid var(--border);
  }
  .badge-meter {
    color: var(--accent);
    border-color: var(--accent);
  }
  .badge-enforcement {
    color: var(--red-light);
    border-color: var(--red-light);
  }
  .badge-garage {
    color: var(--blue-light);
    border-color: var(--blue-light);
  }
  .badge-disability {
    color: var(--yellow);
    border-color: var(--yellow);
  }
  .desc {
    margin: 0;
    color: var(--text-primary);
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    line-height: 1.35;
  }
  .meta {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    color: var(--text-muted);
    font-size: 0.8125rem;
    align-items: baseline;
  }
  .reporter {
    color: var(--text-secondary);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  .dot {
    opacity: 0.5;
  }
</style>
