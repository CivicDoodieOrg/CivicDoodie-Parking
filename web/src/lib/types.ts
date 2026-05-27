import type { z } from "zod";
import type {
  LinkedAccount as LinkedAccountSchema,
  ProfileUser as ProfileUserSchema,
  ScreenNameCheckResponse,
  TownSchema,
  DoodieType as DoodieTypeSchema,
  DoodieListItem as DoodieListItemSchema,
  DoodieListResponse as DoodieListResponseSchema,
  MapPin as MapPinSchema,
} from "../../../src/schemas";

// ---- Auth / Session (better-auth specific) -------------------------

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

// ---- Schemas Inferred from Backend ---------------------------------

export type LinkedAccount = z.infer<typeof LinkedAccountSchema>;
export type User = z.infer<typeof ProfileUserSchema>;
export type ScreenNameCheck = z.infer<typeof ScreenNameCheckResponse>;
export type Town = z.infer<typeof TownSchema>;
export type DoodieType = z.infer<typeof DoodieTypeSchema>;
export type DoodieListItem = z.infer<typeof DoodieListItemSchema>;
export type DoodieListResponse = z.infer<typeof DoodieListResponseSchema>;
export type MapPin = z.infer<typeof MapPinSchema>;
