<script lang="ts">
  import { onMount } from "svelte";
  import { auth, checkAuth } from "$lib/auth.svelte";
  import { api } from "$lib/api";
  import { router, navigate, onLinkClick } from "$lib/router.svelte";
  import type { User } from "$lib/types";
  import Landing from "./pages/Landing.svelte";
  import Onboarding from "./pages/Onboarding.svelte";
  import Profile from "./pages/Profile.svelte";
  import TownDashboard from "./pages/TownDashboard.svelte";
  import TownPicker from "./components/TownPicker.svelte";

  let profile = $state<User | null>(null);
  let profileError = $state<string | null>(null);
  let profileLoading = $state(false);

  type Route =
    | { kind: "home" }
    | { kind: "profile" }
    | { kind: "onboarding" }
    | { kind: "town"; townSlug: string };

  let route: Route = $derived.by<Route>(() => {
    const p = router.path;
    if (p === "/profile") return { kind: "profile" };
    if (p === "/onboarding") return { kind: "onboarding" };
    const m = p.match(/^\/town\/([^/]+)\/?$/);
    if (m) return { kind: "town", townSlug: m[1] };
    return { kind: "home" };
  });

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

  // Force-route signed-in users without a screen_name to /onboarding.
  $effect(() => {
    if (
      auth.user &&
      profile &&
      !profile.screen_name &&
      router.path !== "/onboarding"
    ) {
      navigate("/onboarding");
    }
  });

  // Inverse: hitting /onboarding when already onboarded → bounce to /profile.
  $effect(() => {
    if (profile?.screen_name && router.path === "/onboarding") {
      navigate("/profile");
    }
  });

  // Load profile when auth becomes available; clear on sign-out.
  $effect(() => {
    if (auth.user && !profile && !profileLoading) {
      loadProfile();
    } else if (!auth.user && profile) {
      profile = null;
    }
  });

  onMount(() => {
    checkAuth();
  });

  function onOnboardingDone() {
    profile = null;
    navigate("/profile");
  }
</script>

<header class="topbar">
  <a href="/" class="brand" onclick={onLinkClick("/")}>CivicDoodie Parking</a>
  <nav>
    {#if auth.loading}
      <span class="muted">…</span>
    {:else if auth.user}
      <a href="/profile" onclick={onLinkClick("/profile")}>
        {profile?.screen_name ?? auth.user.name}
      </a>
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
  <Onboarding user={profile} onDone={onOnboardingDone} />
{:else if route.kind === "profile" && profile}
  <Profile user={profile} />
{:else if route.kind === "town"}
  <TownDashboard townSlug={route.townSlug} />
{:else}
  <TownPicker />
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
  .loading {
    max-width: 600px;
    margin: 4rem auto;
    padding: 0 1.5rem;
    text-align: center;
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
