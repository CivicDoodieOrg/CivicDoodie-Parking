<script lang="ts">
  import { signOut } from "$lib/auth.svelte";
  import type { User } from "$lib/types";

  // App.svelte fetches the profile and passes it in; we just render it.
  let { user }: { user: User } = $props();

  function providerLabel(p: string): string {
    if (p === "google") return "Google";
    if (p === "facebook") return "Facebook";
    return p;
  }

  function formatDate(s: string | null): string {
    if (!s) return "—";
    try {
      return new Date(s).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    } catch {
      return s;
    }
  }
</script>

<main>
  <h1>Your profile</h1>

  <!-- Public section -->
  <section>
    <header>
      <h2>Public profile</h2>
      <p class="hint">Visible to anyone who finds your account.</p>
    </header>
    <dl>
      <dt>Screen name</dt>
      <dd class="mono">{user.screen_name ?? "—"}</dd>

      <dt>Display name</dt>
      <dd>{user.name}</dd>

      <dt>Brownie Points</dt>
      <dd>{user.brownie_points}</dd>

      <dt>Country</dt>
      <dd>{user.country ?? "—"}</dd>

      <dt>State / region</dt>
      <dd>{user.state_or_region ?? "—"}</dd>

      <dt>City</dt>
      <dd>{user.city ?? "—"}</dd>

      <dt>Joined</dt>
      <dd>{formatDate(user.created_at)}</dd>
    </dl>
  </section>

  <!-- Brownie Points explainer -->
  <section class="brownie">
    <header>
      <h2>About Brownie Points</h2>
    </header>
    <p>
      Brownie Points are your standing in the CivicDoodie community. They go
      <strong>up</strong> when your reports get upvoted or when admins recognize
      a constructive contribution, and <strong>down</strong> when your reports
      are downvoted, flagged, or removed.
    </p>
    <p>
      Low Brownie Points can lead to rate limits, restricted posting, or — at
      the bottom — account suspension. The full scoring rules are still being
      finalized.
    </p>
  </section>

  <!-- Private section -->
  <section class="private">
    <header>
      <h2>Sign-in details</h2>
      <p class="hint">
        <strong>Private — only you see this.</strong> Never shown to other users.
      </p>
    </header>
    <dl>
      <dt>Email</dt>
      <dd class="mono">{user.email}</dd>

      <dt>Account ID</dt>
      <dd class="mono small">{user.id}</dd>

      <dt>Status</dt>
      <dd>{user.status}</dd>

      <dt>Terms accepted</dt>
      <dd>{user.terms_accepted_at ? formatDate(user.terms_accepted_at) : "Not yet"}</dd>
    </dl>

    <h3>Linked sign-in providers</h3>
    {#if user.accounts.length === 0}
      <p class="hint">None linked.</p>
    {:else}
      <ul class="accounts">
        {#each user.accounts as acc (acc.account_id)}
          <li>
            <span class="provider">{providerLabel(acc.provider)}</span>
            <span class="account-id mono">{acc.account_id}</span>
            <span class="when">linked {formatDate(acc.linked_at)}</span>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  {#if !user.profile_complete}
    <p class="warn">
      Profile incomplete — you'll need to set country and accept the Terms of
      Service before you can file a Doodie. (UI coming soon.)
    </p>
  {/if}

  <div class="actions">
    <button onclick={signOut}>Sign out</button>
  </div>
</main>

<style>
  main {
    max-width: 680px;
    margin: 3rem auto 4rem;
    padding: 0 1.5rem;
  }
  h1 {
    margin-bottom: 2rem;
  }
  section {
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 1.25rem 1.5rem;
    margin-bottom: 1.5rem;
  }
  section header {
    margin-bottom: 1rem;
    padding-bottom: 0.75rem;
    border-bottom: 1px solid var(--border);
  }
  section h2 {
    font-size: 1.125rem;
    margin: 0;
  }
  section h3 {
    font-size: 0.95rem;
    margin: 1.5rem 0 0.5rem;
    color: var(--text-secondary);
  }
  .hint {
    color: var(--text-muted);
    font-size: 0.875rem;
    margin-top: 0.25rem;
  }
  .private header {
    border-bottom-color: var(--accent);
  }
  .private .hint strong {
    color: var(--accent);
  }
  .brownie p {
    color: var(--text-primary);
    margin-bottom: 0.75rem;
    line-height: 1.5;
  }
  .brownie p:last-child { margin-bottom: 0; }
  dl {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 0.5rem 1.5rem;
  }
  dt {
    color: var(--text-muted);
    font-size: 0.875rem;
    align-self: center;
  }
  dd {
    color: var(--text-primary);
  }
  .mono {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  .small {
    font-size: 0.875rem;
  }
  .accounts {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .accounts li {
    display: grid;
    grid-template-columns: 6rem 1fr max-content;
    gap: 0.75rem;
    padding: 0.5rem 0;
    border-bottom: 1px solid var(--border);
    align-items: baseline;
  }
  .accounts li:last-child { border-bottom: none; }
  .provider {
    color: var(--text-primary);
    font-weight: 500;
  }
  .account-id {
    color: var(--text-secondary);
    font-size: 0.875rem;
    overflow-wrap: anywhere;
  }
  .when {
    color: var(--text-muted);
    font-size: 0.75rem;
  }
  .warn {
    background: var(--bg-tertiary);
    border-left: 3px solid var(--yellow);
    padding: 0.75rem 1rem;
    margin-bottom: 1.5rem;
    color: var(--text-secondary);
    border-radius: 4px;
  }
  .actions {
    margin-top: 2rem;
  }
  .actions button {
    background: transparent;
    color: var(--text-primary);
    border: 1px solid var(--border-hover);
    padding: 0.5rem 1rem;
    border-radius: 4px;
    cursor: pointer;
  }
  .actions button:hover {
    background: var(--bg-tertiary);
  }
</style>
