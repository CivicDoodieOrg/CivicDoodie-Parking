import type {
  DoodieListResponse,
  MapPin,
  ScreenNameCheck,
  SessionResponse,
  Town,
  User,
} from "./types";

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

  // Towns
  listTowns: (q?: string) => {
    const qs = q ? `?q=${encodeURIComponent(q)}` : "";
    return json<{ towns: Town[] }>(`/api/towns${qs}`).then((d) => d.towns);
  },

  getTown: (slug: string) =>
    json<{ town: Town }>(`/api/towns/${encodeURIComponent(slug)}`).then(
      (d) => d.town
    ),

  // Doodies
  listDoodies: (
    townSlug: string,
    opts: { sort?: "recent" | "top"; type?: string; page?: number; page_size?: number } = {}
  ) => {
    const params = new URLSearchParams();
    if (opts.sort) params.set("sort", opts.sort);
    if (opts.type) params.set("type", opts.type);
    if (opts.page) params.set("page", String(opts.page));
    if (opts.page_size) params.set("page_size", String(opts.page_size));
    const qs = params.toString() ? `?${params.toString()}` : "";
    return json<DoodieListResponse>(
      `/api/towns/${encodeURIComponent(townSlug)}/doodies${qs}`
    );
  },

  getDashboardMap: (townSlug: string) =>
    json<{ pins: MapPin[] }>(
      `/api/towns/${encodeURIComponent(townSlug)}/dashboard/map`
    ).then((d) => d.pins),
};
