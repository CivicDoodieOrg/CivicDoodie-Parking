import { hc } from "hono/client";
import type { AppType } from "../../../src/index";
import type {
  DoodieListResponse,
  MapPin,
  ScreenNameCheck,
  SessionResponse,
  Town,
  User,
} from "./types";

const client: any = hc<any>("/");

async function handleResponse<T>(respPromise: Promise<Response>): Promise<T> {
  const resp = await respPromise;
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    throw new Error(
      (body as { error?: string; message?: string }).message ||
        (body as { error?: string; message?: string }).error ||
        `HTTP ${resp.status}`
    );
  }
  return resp.json() as Promise<T>;
}

async function handleAuthResponse(respPromise: Promise<Response>) {
  const resp = await respPromise;
  const body = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(
      (body as { message?: string; error?: string }).message ||
        (body as { message?: string; error?: string }).error ||
        `HTTP ${resp.status}`
    );
  }
  return body;
}

export const api = {
  // ---- Better Auth (Wildcard/external route, no typed Hono route) ---

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
    const base = __AUTH_BASE_URL__ || "";
    return fetch(`${base}/api/auth/sign-in/social`, {
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

  signInEmail: (email: string, password: string) => {
    const callbackURL = window.location.origin + "/profile";
    const base = __AUTH_BASE_URL__ || "";
    return handleAuthResponse(
      fetch(`${base}/api/auth/sign-in/email`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, callbackURL }),
      })
    );
  },

  signUpEmail: (fields: { name: string; email: string; password: string }) => {
    const callbackURL = window.location.origin + "/profile";
    const base = __AUTH_BASE_URL__ || "";
    return handleAuthResponse(
      fetch(`${base}/api/auth/sign-up/email`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...fields, callbackURL }),
      })
    );
  },

  requestPasswordReset: (email: string) => {
    const redirectTo = window.location.origin + "/reset-password";
    const base = __AUTH_BASE_URL__ || "";
    return handleAuthResponse(
      fetch(`${base}/api/auth/request-password-reset`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, redirectTo }),
      })
    );
  },

  // ---- Profile / User ----------------------------------------------

  getProfile: () =>
    handleResponse<{ user: User }>(client.api.profile.$get()).then((d) => d.user),

  updateProfile: (fields: { city?: string | null; state_or_region?: string | null; country?: string | null }) =>
    handleResponse<{ ok: boolean }>(
      client.api.profile.$patch({
        json: fields,
      })
    ),

  checkScreenName: (name: string) =>
    handleResponse<ScreenNameCheck>(
      client.api.profile["screen-name"].check.$get({
        query: { name },
      })
    ),

  suggestScreenName: () =>
    handleResponse<{ suggestion: string }>(
      client.api.profile["screen-name"].suggest.$get()
    ).then((d) => d.suggestion),

  setScreenName: (screen_name: string) =>
    handleResponse<{ ok: boolean; screen_name: string }>(
      client.api.profile["screen-name"].$post({
        json: { screen_name },
      })
    ),

  acceptTerms: () =>
    handleResponse<{ ok: boolean }>(client.api.profile["accept-terms"].$post()),

  // ---- Towns -------------------------------------------------------

  listTowns: (q?: string) =>
    handleResponse<{ towns: Town[] }>(
      client.api.towns.$get({
        query: q ? { q } : {},
      })
    ).then((d) => d.towns),

  getTown: (slug: string) =>
    handleResponse<{ town: Town }>(
      client.api.towns[":slug"].$get({
        param: { slug },
      })
    ).then((d) => d.town),

  // ---- Doodies & Map -----------------------------------------------

  listDoodies: (
    townSlug: string,
    opts: { sort?: "recent" | "top"; type?: string; page?: number; page_size?: number } = {}
  ) => {
    const query: Record<string, string> = {};
    if (opts.sort) query.sort = opts.sort;
    if (opts.type) query.type = opts.type;
    if (opts.page) query.page = String(opts.page);
    if (opts.page_size) query.page_size = String(opts.page_size);

    return handleResponse<DoodieListResponse>(
      client.api.towns[":townSlug"].doodies.$get({
        param: { townSlug },
        query,
      })
    );
  },

  getDashboardMap: (townSlug: string) =>
    handleResponse<{ pins: MapPin[] }>(
      client.api.towns[":townSlug"].dashboard.map.$get({
        param: { townSlug },
      })
    ).then((d) => d.pins),
};
