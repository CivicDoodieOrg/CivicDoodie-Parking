<script lang="ts">
  import { onMount } from "svelte";
  import { auth, checkAuth } from "$lib/auth.svelte";
  import Landing from "./pages/Landing.svelte";
  import Profile from "./pages/Profile.svelte";

  let path = $state(window.location.pathname);

  let route = $derived.by(() => {
    if (path === "/profile") return "profile";
    return "home";
  });

  onMount(() => {
    checkAuth();
    const handler = () => {
      path = window.location.pathname;
    };
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  });
</script>

<header class="topbar">
  <a href="/" class="brand">CivicDoodie Parking</a>
  <nav>
    {#if auth.loading}
      <span class="muted">…</span>
    {:else if auth.user}
      <a href="/profile">{auth.user.name}</a>
    {/if}
  </nav>
</header>

{#if auth.loading}
  <main class="loading">Loading…</main>
{:else if route === "profile"}
  {#if auth.user}
    <Profile />
  {:else}
    <Landing />
  {/if}
{:else if auth.user}
  <main class="placeholder">
    <h1>Welcome, {auth.user.name}</h1>
    <p>Town picker and dashboard coming in Phase 2 + 4.</p>
    <p><a href="/profile">View profile</a></p>
  </main>
{:else}
  <Landing />
{/if}

<footer class="version">v{__APP_VERSION__} · {__GIT_REF__}</footer>

<style>
  .topbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1rem 1.5rem;
    border-bottom: 1px solid var(--border);
  }
  .brand {
    font-weight: 600;
    color: var(--text-primary);
  }
  .brand:hover {
    text-decoration: none;
  }
  nav .muted {
    color: var(--text-muted);
  }
  .loading,
  .placeholder {
    max-width: 600px;
    margin: 4rem auto;
    padding: 0 1.5rem;
    text-align: center;
  }
  .placeholder h1 {
    margin-bottom: 1rem;
  }
  .placeholder p {
    color: var(--text-secondary);
    margin-bottom: 0.5rem;
  }
  .version {
    position: fixed;
    bottom: 0.75rem;
    right: 1rem;
    color: var(--text-muted);
    font-size: 0.75rem;
  }
</style>
