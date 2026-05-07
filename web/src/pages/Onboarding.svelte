<script lang="ts">
  import { api } from "$lib/api";
  import { signOut } from "$lib/auth.svelte";
  import type { User } from "$lib/types";

  let { user, onDone }: { user: User; onDone: () => void } = $props();

  let candidate = $state(user.screen_name_suggestion ?? "");
  let acknowledged = $state(false);
  let submitting = $state(false);
  let suggesting = $state(false);
  let submitError = $state<string | null>(null);

  // Strip whitespace as the user types so what they see is exactly what gets
  // submitted. Case is preserved — uniqueness and lookups are case-insensitive
  // server-side, so the user's chosen case shows up wherever their handle does.
  function onInput(e: Event) {
    const t = e.target as HTMLInputElement;
    const cleaned = t.value.replace(/\s+/g, "");
    if (cleaned !== t.value) t.value = cleaned;
    candidate = cleaned;
  }

  async function tryAnother() {
    suggesting = true;
    try {
      candidate = await api.suggestScreenName();
    } catch {
      // Silently ignore — user can keep typing or try again.
    }
    suggesting = false;
  }

  // Live availability check (debounced).
  let checkResult = $state<{
    state: "idle" | "checking" | "available" | "invalid" | "taken";
    message?: string;
  }>({ state: "idle" });
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  $effect(() => {
    const name = candidate;
    if (debounceTimer) clearTimeout(debounceTimer);
    if (!name) {
      checkResult = { state: "idle" };
      return;
    }
    checkResult = { state: "checking" };
    debounceTimer = setTimeout(async () => {
      try {
        const result = await api.checkScreenName(name);
        if (candidate !== name) return; // stale
        if (result.available) {
          checkResult = { state: "available" };
        } else {
          checkResult = {
            state: result.reason === "taken" ? "taken" : "invalid",
            message: result.message,
          };
        }
      } catch (e) {
        checkResult = {
          state: "invalid",
          message: e instanceof Error ? e.message : String(e),
        };
      }
    }, 250);
  });

  let canSubmit = $derived(
    acknowledged && checkResult.state === "available" && !submitting
  );

  async function submit() {
    if (!canSubmit) return;
    submitting = true;
    submitError = null;
    try {
      await api.setScreenName(candidate);
      onDone();
    } catch (e) {
      submitError = e instanceof Error ? e.message : String(e);
      submitting = false;
    }
  }
</script>

<main>
  <h1>Pick your screen name</h1>
  <p class="lede">
    Welcome, {user.name}. Before you can use CivicDoodie, choose a screen name.
  </p>

  <div class="warning" role="alert">
    <strong>Choose carefully.</strong>
    <ul>
      <li>Your screen name is <strong>visible to everyone</strong> on every Doodie and comment you post.</li>
      <li>It <strong>cannot be changed later</strong>. Not by you, not by support.</li>
      <li>Don't include your real name or anything else you want kept private.</li>
    </ul>
  </div>

  <label class="field">
    <span>Screen name</span>
    <div class="input-row">
      <input
        type="text"
        value={candidate}
        oninput={onInput}
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
        maxlength="30"
        placeholder="letters, digits, hyphens"
      />
      <button
        type="button"
        class="suggest"
        onclick={tryAnother}
        disabled={suggesting}
        title="Suggest a fresh random name"
      >
        {suggesting ? "…" : "Try another"}
      </button>
    </div>
    <span class="status status-{checkResult.state}">
      {#if checkResult.state === "idle"}
        &nbsp;
      {:else if checkResult.state === "checking"}
        Checking…
      {:else if checkResult.state === "available"}
        Available — this will be your permanent screen name.
      {:else}
        {checkResult.message}
      {/if}
    </span>
  </label>

  <label class="ack">
    <input type="checkbox" bind:checked={acknowledged} />
    <span>
      I understand my screen name is <strong>public</strong> and
      <strong>permanent</strong>.
    </span>
  </label>

  {#if submitError}
    <p class="err">{submitError}</p>
  {/if}

  <div class="actions">
    <button class="primary" onclick={submit} disabled={!canSubmit}>
      {submitting ? "Saving…" : "Lock it in"}
    </button>
    <button class="ghost" onclick={signOut} disabled={submitting}>
      Sign out
    </button>
  </div>
</main>

<style>
  main {
    max-width: 540px;
    margin: 4rem auto;
    padding: 0 1.5rem;
  }
  h1 {
    margin-bottom: 0.5rem;
  }
  .lede {
    color: var(--text-secondary);
    margin-bottom: 2rem;
  }
  .warning {
    background: rgba(251, 191, 36, 0.08);
    border: 1px solid var(--yellow);
    border-left-width: 4px;
    padding: 1rem 1.25rem;
    border-radius: 4px;
    margin-bottom: 2rem;
  }
  .warning strong {
    color: var(--yellow);
  }
  .warning ul {
    margin: 0.5rem 0 0 1rem;
    color: var(--text-primary);
  }
  .warning li {
    margin-bottom: 0.25rem;
  }
  .field {
    display: block;
    margin-bottom: 1.5rem;
  }
  .field > span:first-child {
    display: block;
    margin-bottom: 0.4rem;
    color: var(--text-secondary);
    font-size: 0.875rem;
  }
  .input-row {
    display: flex;
    gap: 0.5rem;
  }
  input[type="text"] {
    flex: 1;
    padding: 0.625rem 0.75rem;
    background: var(--bg-secondary);
    color: var(--text-primary);
    border: 1px solid var(--border-hover);
    border-radius: 4px;
    font-size: 1rem;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  input[type="text"]:focus {
    outline: none;
    border-color: var(--accent);
  }
  .suggest {
    background: transparent;
    color: var(--text-secondary);
    border: 1px solid var(--border-hover);
    border-radius: 4px;
    padding: 0 0.85rem;
    font-size: 0.875rem;
    cursor: pointer;
    white-space: nowrap;
  }
  .suggest:hover:not(:disabled) {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }
  .suggest:disabled {
    opacity: 0.5;
    cursor: wait;
  }
  .status {
    display: block;
    margin-top: 0.4rem;
    font-size: 0.875rem;
    min-height: 1.2em;
  }
  .status-checking { color: var(--text-muted); }
  .status-available { color: var(--green); }
  .status-invalid, .status-taken { color: var(--red); }
  .ack {
    display: flex;
    align-items: flex-start;
    gap: 0.6rem;
    margin-bottom: 1.5rem;
    cursor: pointer;
    padding: 0.5rem 0;
  }
  .ack input { margin-top: 0.2rem; }
  .ack span { color: var(--text-primary); }
  .err {
    color: var(--red);
    margin-bottom: 1rem;
  }
  .actions {
    display: flex;
    gap: 0.75rem;
  }
  .primary {
    flex: 1;
    background: var(--accent);
    color: white;
    border: none;
    padding: 0.75rem 1rem;
    font-size: 1rem;
    border-radius: 6px;
    cursor: pointer;
  }
  .primary:hover:not(:disabled) { background: var(--accent-hover); }
  .primary:disabled { opacity: 0.4; cursor: not-allowed; }
  .ghost {
    background: transparent;
    color: var(--text-secondary);
    border: 1px solid var(--border-hover);
    padding: 0.75rem 1rem;
    border-radius: 6px;
    cursor: pointer;
  }
  .ghost:hover:not(:disabled) { background: var(--bg-tertiary); }
</style>
