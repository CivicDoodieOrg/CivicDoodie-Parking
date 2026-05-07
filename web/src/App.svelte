<script lang="ts">
  let health = $state<string | null>(null);
  let error = $state<string | null>(null);

  async function checkHealth() {
    try {
      const resp = await fetch("/api/health");
      const body = await resp.json();
      health = body.status;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  $effect(() => {
    checkHealth();
  });
</script>

<main>
  <h1>CivicDoodie Parking</h1>
  <p class="tagline">Report parking-meter, garage, and enforcement issues in your town.</p>
  <p class="status">
    API:
    {#if health}
      <span class="ok">{health}</span>
    {:else if error}
      <span class="err">{error}</span>
    {:else}
      checking…
    {/if}
  </p>
  <p class="version">v{__APP_VERSION__} · {__GIT_REF__}</p>
</main>

<style>
  main {
    max-width: 600px;
    margin: 4rem auto;
    padding: 0 1.5rem;
  }
  h1 {
    font-size: 2rem;
    margin-bottom: 0.5rem;
  }
  .tagline {
    color: var(--text-secondary);
    margin-bottom: 2rem;
  }
  .status {
    margin-bottom: 2rem;
  }
  .ok {
    color: var(--green);
  }
  .err {
    color: var(--red);
  }
  .version {
    color: var(--text-muted);
    font-size: 0.875rem;
  }
</style>
