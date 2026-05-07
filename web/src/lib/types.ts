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

// ---- Towns / Doodies ------------------------------------------------

export interface Town {
  id: string;
  slug: string;
  name: string;
  state_or_region: string | null;
  country: string;
  lat: number;
  lng: number;
}

export type DoodieType = "enforcement" | "meter" | "garage";

export interface DoodieListItem {
  id: string;
  slug: string;
  type: DoodieType;
  description: string;
  disability_related: boolean;
  lat: number | null;
  lng: number | null;
  upvotes_count: number;
  downvotes_count: number;
  comments_count: number;
  created_at: string;
  reporter: { screen_name: string | null };
  image_count: number;
  first_image_url: string | null;
}

export interface DoodieListResponse {
  doodies: DoodieListItem[];
  page: number;
  page_size: number;
  total: number;
  sort: "recent" | "top";
}

export interface MapPin {
  id: string;
  slug: string;
  type: DoodieType;
  lat: number;
  lng: number;
  upvotes_count: number;
  downvotes_count: number;
}
