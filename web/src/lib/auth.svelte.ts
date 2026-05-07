import { api } from "./api";
import type { SessionUser } from "./types";

export const auth: { user: SessionUser | null; loading: boolean } = $state({
  user: null,
  loading: true,
});

export async function checkAuth() {
  auth.loading = true;
  try {
    const session = await api.getSession();
    auth.user = session?.user ?? null;
  } catch {
    auth.user = null;
  }
  auth.loading = false;
}

export async function signOut() {
  try {
    await api.signOut();
  } catch {
    // Sign-out may fail (CSRF, network) — still clear local state.
  }
  auth.user = null;
  window.location.replace("/");
}
