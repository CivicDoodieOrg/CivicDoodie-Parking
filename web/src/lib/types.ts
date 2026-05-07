export interface LinkedAccount {
  provider: string;
  account_id: string;
  linked_at: string;
}

export interface User {
  id: string;
  name: string;
  email: string;
  image?: string | null;
  screen_name: string | null;
  screen_name_suggestion: string | null;
  city: string | null;
  state_or_region: string | null;
  country: string | null;
  brownie_points: number;
  status: "active" | "restricted" | "suspended" | "banned";
  terms_accepted_at: string | null;
  created_at: string | null;
  profile_complete: boolean;
  accounts: LinkedAccount[];
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

export type ScreenNameCheck =
  | { available: true }
  | { available: false; reason: "invalid" | "taken"; message: string };
