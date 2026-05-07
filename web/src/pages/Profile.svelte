<script lang="ts">
  import { api } from "$lib/api";
  import { auth, signOut } from "$lib/auth.svelte";
  import type { User } from "$lib/types";

  let profile = $state<User | null>(null);
  let error = $state<string | null>(null);
  let loading = $state(true);

  async function load() {
    loading = true;
    error = null;
    try {
      profile = await api.getProfile();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    loading = false;
  }

  $effect(() => {
    if (auth.user) load();
  });
</script>

<main>
  <h1>Your Profile</h1>

  {#if loading}
    <p>Loading…</p>
  {:else if error}
    <p class="err">{error}</p>
  {:else if profile}
    <dl>
      <dt>Screen name</dt>
      <dd>{profile.screen_name ?? "—"}</dd>

      <dt>Display name</dt>
      <dd>{profile.name}</dd>

      <dt>Brownie Points</dt>
      <dd>{profile.brownie_points}</dd>

      <dt>Country</dt>
      <dd>{profile.country ?? "—"}</dd>

      <dt>State / region</dt>
      <dd>{profile.state_or_region ?? "—"}</dd>

      <dt>City</dt>
      <dd>{profile.city ?? "—"}</dd>

      <dt>Status</dt>
      <dd>{profile.status}</dd>
    </dl>

    {#if !profile.profile_complete}
      <p class="warn">
        Profile incomplete — country and Terms acceptance are required before
        you can file a Doodie.
      </p>
    {/if}

    <button onclick={signOut}>Sign out</button>
  {/if}
</main>

<style>
  main {
    max-width: 600px;
    margin: 4rem auto;
    padding: 0 1.5rem;
  }
  h1 {
    margin-bottom: 2rem;
  }
  dl {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 0.5rem 1.5rem;
    margin-bottom: 2rem;
  }
  dt {
    color: var(--text-muted);
  }
  dd {
    color: var(--text-primary);
  }
  .warn {
    background: var(--bg-tertiary);
    border-left: 3px solid var(--yellow);
    padding: 0.75rem 1rem;
    margin-bottom: 1.5rem;
    color: var(--text-secondary);
    border-radius: 4px;
  }
  .err {
    color: var(--red);
  }
  button {
    background: transparent;
    color: var(--text-primary);
    border: 1px solid var(--border-hover);
    padding: 0.5rem 1rem;
    border-radius: 4px;
    cursor: pointer;
  }
  button:hover {
    background: var(--bg-tertiary);
  }
</style>
