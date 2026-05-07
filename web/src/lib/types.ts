export interface User {
  id: string;
  name: string;
  image?: string | null;
  screen_name: string | null;
  city: string | null;
  state_or_region: string | null;
  country: string | null;
  brownie_points: number;
  status: "active" | "restricted" | "suspended" | "banned";
  terms_accepted_at: string | null;
  profile_complete: boolean;
}

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  image?: string | null;
}

export interface SessionResponse {
  user: SessionUser;
  session: { id: string; userId: string; expiresAt: string };
}
