<script lang="ts">
  import { api } from "$lib/api";
  import { navigate, onLinkClick } from "$lib/router.svelte";
  import type { DoodieListResponse, Town } from "$lib/types";
  import DoodieCard from "../components/DoodieCard.svelte";

  let { townSlug }: { townSlug: string } = $props();

  type Tab = "recent" | "top" | "map";

  let tab = $state<Tab>("recent");
  let town = $state<Town | null>(null);
  let list = $state<DoodieListResponse | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);

  let page = $state(1);

  async function loadTown() {
    try {
      town = await api.getTown(townSlug);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  async function loadList(sort: "recent" | "top", p: number) {
    loading = true;
    error = null;
    try {
      list = await api.listDoodies(townSlug, { sort, page: p });
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    loading = false;
  }

  $effect(() => {
    loadTown();
  });

  $effect(() => {
    if (tab === "recent" || tab === "top") {
      loadList(tab, page);
    }
  });

  function setTab(next: Tab) {
    if (next === tab) return;
    tab = next;
    page = 1;
  }

  function totalPages(total: number, size: number): number {
    return Math.max(1, Math.ceil(total / size));
  }
</script>

<main>
  <header class="head">
    {#if town}
      <h1>{town.name}</h1>
      <p class="region">
        {town.state_or_region ?? ""}{town.state_or_region ? ", " : ""}{town.country}
      </p>
    {:else}
      <h1>Loading…</h1>
    {/if}

    <div class="actions">
      <a
        class="btn-primary"
        href={`/town/${townSlug}/report`}
        onclick={onLinkClick(`/town/${townSlug}/report`)}
      >
        File a Doodie
      </a>
    </div>
  </header>

  <nav class="tabs" aria-label="Dashboard view">
    <button class:active={tab === "recent"} onclick={() => setTab("recent")}>Recent</button>
    <button class:active={tab === "top"} onclick={() => setTab("top")}>Top</button>
    <button class:active={tab === "map"} onclick={() => setTab("map")}>Map</button>
  </nav>

  {#if error}
    <p class="err">{error}</p>
  {/if}

  {#if tab === "map"}
    <div class="placeholder">
      <p>Map view coming soon.</p>
      <p class="muted">
        Pin clustering with MapLibre lands in the next slice. The data is ready
        at <code>/api/towns/{townSlug}/dashboard/map</code>.
      </p>
    </div>
  {:else if loading && !list}
    <p class="muted">Loading…</p>
  {:else if list && list.doodies.length === 0}
    <div class="empty">
      <p>No Doodies in {town?.name ?? "this town"} yet.</p>
      <p class="muted">Be the first — file one above.</p>
    </div>
  {:else if list}
    <ul class="cards">
      {#each list.doodies as d (d.id)}
        <li><DoodieCard {townSlug} doodie={d} /></li>
      {/each}
    </ul>

    {#if list.total > list.page_size}
      <nav class="pagination">
        <button onclick={() => (page = Math.max(1, page - 1))} disabled={page <= 1}>
          ← Prev
        </button>
        <span class="page-info">
          Page {list.page} of {totalPages(list.total, list.page_size)}
          · {list.total} total
        </span>
        <button
          onclick={() => (page = Math.min(totalPages(list?.total ?? 0, list?.page_size ?? 20), page + 1))}
          disabled={page >= totalPages(list.total, list.page_size)}
        >
          Next →
        </button>
      </nav>
    {/if}
  {/if}

  <p class="back">
    <a href="/" onclick={onLinkClick("/")}>← All towns</a>
  </p>
</main>

<style>
  main {
    max-width: 880px;
    margin: 2rem auto 4rem;
    padding: 0 1.5rem;
  }
  .head {
    display: flex;
    align-items: flex-end;
    gap: 1rem;
    margin-bottom: 1.5rem;
    padding-bottom: 1rem;
    border-bottom: 1px solid var(--border);
  }
  .head h1 {
    margin: 0;
  }
  .region {
    color: var(--text-muted);
    margin: 0;
    font-size: 0.95rem;
  }
  .actions {
    margin-left: auto;
  }
  .btn-primary {
    background: var(--accent);
    color: white;
    padding: 0.5rem 1rem;
    border-radius: 6px;
    font-weight: 500;
  }
  .btn-primary:hover {
    background: var(--accent-hover);
    text-decoration: none;
  }
  .tabs {
    display: flex;
    gap: 0.25rem;
    margin-bottom: 1.5rem;
    border-bottom: 1px solid var(--border);
  }
  .tabs button {
    background: transparent;
    color: var(--text-secondary);
    border: none;
    padding: 0.625rem 1rem;
    cursor: pointer;
    font-size: 0.9rem;
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
  }
  .tabs button:hover {
    color: var(--text-primary);
  }
  .tabs button.active {
    color: var(--text-primary);
    border-bottom-color: var(--accent);
  }
  .cards {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .empty,
  .placeholder {
    text-align: center;
    padding: 3rem 1rem;
    color: var(--text-secondary);
  }
  .empty p,
  .placeholder p {
    margin: 0.4rem 0;
  }
  .placeholder code {
    background: var(--bg-tertiary);
    padding: 0.1rem 0.4rem;
    border-radius: 4px;
    font-size: 0.85rem;
  }
  .muted {
    color: var(--text-muted);
  }
  .err {
    color: var(--red);
  }
  .pagination {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 1.5rem;
  }
  .pagination button {
    background: transparent;
    color: var(--text-primary);
    border: 1px solid var(--border-hover);
    padding: 0.4rem 0.85rem;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.875rem;
  }
  .pagination button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .pagination button:not(:disabled):hover {
    background: var(--bg-tertiary);
  }
  .page-info {
    color: var(--text-muted);
    font-size: 0.875rem;
  }
  .back {
    margin-top: 2rem;
    color: var(--text-muted);
    font-size: 0.875rem;
  }
</style>
