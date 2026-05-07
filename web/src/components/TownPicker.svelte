<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "$lib/api";
  import { navigate } from "$lib/router.svelte";
  import type { Town } from "$lib/types";

  let allTowns = $state<Town[] | null>(null);
  let error = $state<string | null>(null);
  let query = $state("");

  onMount(async () => {
    try {
      allTowns = await api.listTowns();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  });

  // 52 towns is small — filter client-side as the user types.
  let filtered = $derived.by(() => {
    if (!allTowns) return [];
    const q = query.trim().toLowerCase();
    if (!q) return allTowns;
    return allTowns.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.slug.toLowerCase().includes(q) ||
        (t.state_or_region?.toLowerCase() ?? "").includes(q)
    );
  });

  function pick(slug: string) {
    navigate(`/town/${slug}`);
  }
</script>

<section>
  <h2>Pick a town</h2>
  <p class="hint">Choose a municipality to see its parking-issue dashboard or file a new Doodie.</p>

  <input
    type="search"
    placeholder="Search by name, state, or slug…"
    bind:value={query}
    autocomplete="off"
    spellcheck="false"
  />

  {#if error}
    <p class="err">{error}</p>
  {:else if !allTowns}
    <p class="muted">Loading…</p>
  {:else if filtered.length === 0}
    <p class="muted">No towns match "{query}".</p>
  {:else}
    <ul class="towns">
      {#each filtered as t (t.id)}
        <li>
          <button onclick={() => pick(t.slug)}>
            <span class="name">{t.name}</span>
            <span class="region">{t.state_or_region ?? ""}{t.state_or_region ? ", " : ""}{t.country}</span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  section {
    max-width: 640px;
    margin: 3rem auto 4rem;
    padding: 0 1.5rem;
  }
  h2 {
    margin-bottom: 0.25rem;
  }
  .hint {
    color: var(--text-secondary);
    margin-bottom: 1.5rem;
  }
  input {
    width: 100%;
    padding: 0.625rem 0.75rem;
    background: var(--bg-secondary);
    color: var(--text-primary);
    border: 1px solid var(--border-hover);
    border-radius: 4px;
    font-size: 1rem;
    margin-bottom: 1rem;
  }
  input:focus {
    outline: none;
    border-color: var(--accent);
  }
  .muted {
    color: var(--text-muted);
  }
  .err {
    color: var(--red);
  }
  .towns {
    list-style: none;
    padding: 0;
    margin: 0;
    border: 1px solid var(--border);
    border-radius: 6px;
    max-height: 60vh;
    overflow-y: auto;
  }
  .towns li {
    border-bottom: 1px solid var(--border);
  }
  .towns li:last-child {
    border-bottom: none;
  }
  button {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    width: 100%;
    text-align: left;
    background: transparent;
    color: var(--text-primary);
    border: none;
    padding: 0.7rem 1rem;
    cursor: pointer;
    font-size: 0.95rem;
  }
  button:hover {
    background: var(--bg-tertiary);
  }
  .name {
    font-weight: 500;
  }
  .region {
    color: var(--text-muted);
    font-size: 0.875rem;
  }
</style>
