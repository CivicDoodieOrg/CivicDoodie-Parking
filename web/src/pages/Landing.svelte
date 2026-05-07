<script lang="ts">
  import { api } from "$lib/api";

  let busy = $state<"google" | "facebook" | null>(null);
  let error = $state<string | null>(null);

  async function login(provider: "google" | "facebook") {
    busy = provider;
    error = null;
    try {
      await api.signInWith(provider);
    } catch (e) {
      busy = null;
      error = e instanceof Error ? e.message : String(e);
    }
  }
</script>

<main>
  <h1>CivicDoodie Parking</h1>
  <p class="tagline">
    Report parking-meter, garage, and enforcement issues in your town.
  </p>

  <div class="auth">
    <button onclick={() => login("google")} disabled={busy !== null}>
      {busy === "google" ? "Redirecting…" : "Sign in with Google"}
    </button>
    <button onclick={() => login("facebook")} disabled={busy !== null}>
      {busy === "facebook" ? "Redirecting…" : "Sign in with Facebook"}
    </button>
  </div>

  {#if error}
    <p class="err">{error}</p>
  {/if}

  <p class="footnote">
    By signing in you agree to the <a href="/terms">Terms of Service</a> and
    acknowledge the <a href="/privacy">Privacy Policy</a>.
  </p>
</main>

<style>
  main {
    max-width: 480px;
    margin: 6rem auto;
    padding: 0 1.5rem;
    text-align: center;
  }
  h1 {
    font-size: 2.25rem;
    margin-bottom: 0.5rem;
  }
  .tagline {
    color: var(--text-secondary);
    margin-bottom: 2.5rem;
  }
  .auth {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    margin-bottom: 1.5rem;
  }
  button {
    background: var(--accent);
    color: white;
    border: none;
    padding: 0.75rem 1rem;
    font-size: 1rem;
    border-radius: 6px;
    cursor: pointer;
    transition: background 0.15s;
  }
  button:hover:not(:disabled) {
    background: var(--accent-hover);
  }
  button:disabled {
    opacity: 0.5;
    cursor: wait;
  }
  .err {
    color: var(--red);
    margin-bottom: 1rem;
  }
  .footnote {
    color: var(--text-muted);
    font-size: 0.875rem;
  }
</style>
