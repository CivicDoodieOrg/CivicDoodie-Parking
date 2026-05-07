<script lang="ts">
  import { onMount } from "svelte";
  import { auth, checkAuth } from "$lib/auth.svelte";
  import { api } from "$lib/api";
  import type { User } from "$lib/types";
  import Landing from "./pages/Landing.svelte";
  import Onboarding from "./pages/Onboarding.svelte";
  import Profile from "./pages/Profile.svelte";

  let path = $state(window.location.pathname);
  let profile = $state<User | null>(null);
  let profileError = $state<string | null>(null);
  let profileLoading = $state(false);

  let route = $derived.by(() => {
    if (path === "/profile") return "profile";
    if (path === "/onboarding") return "onboarding";
    return "home";
  });

  function navigate(to: string) {
    if (to === window.location.pathname) return;
    window.history.pushState({}, "", to);
    path = to;
  }

  async function loadProfile() {
    profileLoading = true;
    profileError = null;
    try {
      profile = await api.getProfile();
    } catch (e) {
      profileError = e instanceof Error ? e.message : String(e);
    }
    profileLoading = false;
  }

  // When signed-in but screen_name is missing, force-route to /onboarding.
  // (Doing this in an effect — runs on auth change and on profile change.)
  $effect(() => {
    if (auth.user && profile && !profile.screen_name && path !== "/onboarding") {
      navigate("/onboarding");
    }
  });

  // Inverse: visiting /onboarding when already onboarded → bounce to /profile.
  $effect(() => {
    if (profile?.screen_name && path === "/onboarding") {
      navigate("/profile");
    }
  });

  // When auth is established, fetch profile. Clear it on sign-out.
  $effect(() => {
    if (auth.user && !profile && !profileLoading) {
      loadProfile();
    } else if (!auth.user && profile) {
      profile = null;
    }
  });

  onMount(() => {
    checkAuth();
    const handler = () => {
      path = window.location.pathname;
    };
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  });

  function onOnboardingDone() {
    profile = null; // force refresh from server with new screen_name
    navigate("/profile");
  }
</script>

<header class="topbar">
  <a href="/" class="brand">CivicDoodie Parking</a>
  <nav>
    {#if auth.loading}
      <span class="muted">…</span>
    {:else if auth.user}
      {#if profile?.screen_name}
        <a href="/profile">{profile.screen_name}</a>
      {:else}
        <a href="/profile">{auth.user.name}</a>
      {/if}
    {/if}
  </nav>
</header>

{#if auth.loading}
  <main class="loading">Loading…</main>
{:else if !auth.user}
  <Landing />
{:else if profileLoading && !profile}
  <main class="loading">Loading…</main>
{:else if profileError && !profile}
  <main class="loading"><p class="err">{profileError}</p></main>
{:else if profile && !profile.screen_name}
  <!-- Forced onboarding: ignore route until screen_name is set. -->
  <Onboarding user={profile} onDone={onOnboardingDone} />
{:else if route === "profile" && profile}
  <Profile user={profile} />
{:else}
  <main class="placeholder">
    <h1>Welcome, {profile?.screen_name ?? auth.user.name}</h1>
    <p>Town picker and dashboard coming in Phase 4.</p>
    <p><a href="/profile">View profile</a></p>
  </main>
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
  .err {
    color: var(--red);
  }
  .version {
    position: fixed;
    bottom: 0.75rem;
    right: 1rem;
    color: var(--text-muted);
    font-size: 0.75rem;
  }
</style>
