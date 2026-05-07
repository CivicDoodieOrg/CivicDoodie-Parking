import type { ScreenNameCheck, SessionResponse, User } from "./types";

async function json<T>(url: string, opts?: RequestInit): Promise<T> {
  const resp = await fetch(url, {
    credentials: "include",
    ...opts,
  });
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error || `HTTP ${resp.status}`);
  }
  return resp.json();
}

export const api = {
  getSession: (): Promise<SessionResponse | null> =>
    fetch("/api/auth/get-session", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null),

  signOut: () =>
    fetch("/api/auth/sign-out", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    }),

  signInWith: (provider: "google" | "facebook") => {
    const callbackURL = window.location.origin + "/profile";
    return fetch("/api/auth/sign-in/social", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider, callbackURL }),
    })
      .then((r) => r.json())
      .then((body: { url?: string; redirect?: boolean }) => {
        if (body.url) window.location.href = body.url;
      });
  },

  getProfile: () => json<{ user: User }>("/api/profile").then((d) => d.user),

  updateProfile: (fields: { city?: string | null; state_or_region?: string | null; country?: string | null }) =>
    json<{ ok: boolean }>("/api/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    }),

  checkScreenName: (name: string) =>
    json<ScreenNameCheck>(
      `/api/profile/screen-name/check?name=${encodeURIComponent(name)}`
    ),

  suggestScreenName: () =>
    json<{ suggestion: string }>("/api/profile/screen-name/suggest").then(
      (d) => d.suggestion
    ),

  setScreenName: (screen_name: string) =>
    json<{ ok: boolean; screen_name: string }>("/api/profile/screen-name", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ screen_name }),
    }),

  acceptTerms: () =>
    json<{ ok: boolean }>("/api/profile/accept-terms", { method: "POST" }),
};
