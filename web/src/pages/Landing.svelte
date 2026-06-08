<script lang="ts">
  import { api } from "$lib/api";
  import { checkAuth } from "$lib/auth.svelte";

  let busy = $state<"google" | "facebook" | null>(null);
  let emailBusy = $state(false);
  let mode = $state<"signin" | "signup" | "reset">("signin");
  let name = $state("");
  let email = $state("");
  let password = $state("");
  let error = $state<string | null>(null);
  let notice = $state<string | null>(null);

  async function login(provider: "google" | "facebook") {
    busy = provider;
    error = null;
    notice = null;
    try {
      await api.signInWith(provider);
    } catch (e) {
      busy = null;
      error = e instanceof Error ? e.message : String(e);
    }
  }

  async function submitEmail(event: SubmitEvent) {
    event.preventDefault();
    emailBusy = true;
    error = null;
    notice = null;
    try {
      if (mode === "signin") {
        await api.signInEmail(email, password);
        await checkAuth();
      } else if (mode === "signup") {
        await api.signUpEmail({ name: name.trim(), email, password });
        await checkAuth();
        notice = "Account created. Check your inbox for the verification email.";
      } else {
        await api.requestPasswordReset(email);
        notice = "If that email exists, a reset link is on the way.";
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      emailBusy = false;
    }
  }

  function switchMode(next: "signin" | "signup" | "reset") {
    mode = next;
    error = null;
    notice = null;
  }
</script>

<main>
  <h1>CivicDoodie Parking</h1>
  <p class="tagline">
    Report parking-meter, garage, and enforcement issues in your town.
  </p>

  <form class="email-auth" onsubmit={submitEmail}>
    <div class="modes" aria-label="Email authentication mode">
      <button
        type="button"
        class:active={mode === "signin"}
        onclick={() => switchMode("signin")}
      >
        Sign in
      </button>
      <button
        type="button"
        class:active={mode === "signup"}
        onclick={() => switchMode("signup")}
      >
        Create account
      </button>
    </div>

    {#if mode === "signup"}
      <label>
        Name
        <input
          autocomplete="name"
          bind:value={name}
          disabled={emailBusy}
          required
        />
      </label>
    {/if}

    <label>
      Email
      <input
        type="email"
        autocomplete="email"
        bind:value={email}
        disabled={emailBusy}
        required
      />
    </label>

    {#if mode !== "reset"}
      <label>
        Password
        <input
          type="password"
          autocomplete={mode === "signin" ? "current-password" : "new-password"}
          minlength="8"
          bind:value={password}
          disabled={emailBusy}
          required
        />
      </label>
    {/if}

    <button type="submit" disabled={emailBusy || busy !== null}>
      {#if emailBusy}
        Working…
      {:else if mode === "signup"}
        Create account
      {:else if mode === "reset"}
        Send reset link
      {:else}
        Sign in with email
      {/if}
    </button>

    <button
      type="button"
      class="link-button"
      onclick={() => switchMode(mode === "reset" ? "signin" : "reset")}
      disabled={emailBusy}
    >
      {mode === "reset" ? "Back to sign in" : "Forgot password?"}
    </button>
  </form>

  <div class="divider"><span>or</span></div>

  <div class="social-auth">
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
  {#if notice}
    <p class="notice">{notice}</p>
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
  .email-auth,
  .social-auth {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .email-auth {
    margin-bottom: 1.5rem;
    text-align: left;
  }
  .modes {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.5rem;
  }
  .modes button {
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    color: var(--text-secondary);
  }
  .modes button.active {
    background: var(--accent);
    border-color: var(--accent);
    color: white;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    color: var(--text-secondary);
    font-size: 0.875rem;
  }
  input {
    width: 100%;
    background: var(--bg-secondary);
    color: var(--text-primary);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 0.75rem 0.85rem;
    font: inherit;
  }
  input:focus {
    border-color: var(--accent);
    outline: none;
  }
  .social-auth {
    margin-bottom: 1.5rem;
  }
  .divider {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    color: var(--text-muted);
    font-size: 0.75rem;
    margin: 1.5rem 0;
    text-transform: uppercase;
  }
  .divider::before,
  .divider::after {
    content: "";
    flex: 1;
    border-top: 1px solid var(--border);
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
  .link-button {
    background: transparent;
    color: var(--blue);
    padding: 0.25rem 0;
  }
  .link-button:hover:not(:disabled) {
    background: transparent;
    text-decoration: underline;
  }
  .err {
    color: var(--red);
    margin-bottom: 1rem;
  }
  .notice {
    color: var(--green-light);
    margin-bottom: 1rem;
  }
  .footnote {
    color: var(--text-muted);
    font-size: 0.875rem;
  }
</style>
