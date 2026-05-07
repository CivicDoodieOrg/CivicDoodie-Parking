// Zod + OpenAPI schemas. Used purely for API documentation —
// the actual route handlers do their own validation and may be more
// permissive than what's documented here. Keep these in sync with what
// the handlers actually accept and return.

import { z } from "@hono/zod-openapi";

// ---- Shared --------------------------------------------------------

export const ErrorSchema = z
  .object({ error: z.string() })
  .openapi("Error");

export const OkSchema = z
  .object({ ok: z.boolean() })
  .openapi("Ok");

export const ChangedOkSchema = z
  .object({ ok: z.boolean(), changed: z.boolean() })
  .openapi("ChangedOk");

export const HealthSchema = z
  .object({ status: z.string() })
  .openapi("Health");

// ---- Path params ---------------------------------------------------

export const TownSlugParam = z
  .string()
  .openapi({ param: { name: "townSlug", in: "path" }, example: "boston-ma" });

export const DoodieSlugParam = z
  .string()
  .openapi({ param: { name: "doodieSlug", in: "path" }, example: "abc12345" });

export const PositionParam = z
  .string()
  .openapi({ param: { name: "position", in: "path" }, example: "0" });

export const IdParam = z
  .string()
  .openapi({ param: { name: "id", in: "path" }, example: "uuid-here" });

export const CommentIdParam = z
  .string()
  .openapi({ param: { name: "commentId", in: "path" }, example: "uuid-here" });

// ---- Enums ---------------------------------------------------------

export const DoodieType = z.enum(["enforcement", "meter", "garage"]).openapi("DoodieType");
export const ModerationStatus = z
  .enum(["pending", "approved", "flagged", "removed"])
  .openapi("ModerationStatus");
export const UserStatus = z
  .enum(["active", "restricted", "suspended", "banned"])
  .openapi("UserStatus");
export const VoteType = z.enum(["up", "down"]).openapi("VoteType");
export const ReportStatus = z
  .enum(["pending", "reviewed", "actioned", "dismissed"])
  .openapi("ReportStatus");
export const ReportTargetType = z.enum(["doodie", "comment"]).openapi("ReportTargetType");

// ---- Towns ---------------------------------------------------------

export const TownSchema = z
  .object({
    id: z.string(),
    slug: z.string(),
    name: z.string(),
    state_or_region: z.string().nullable(),
    country: z.string(),
    lat: z.number(),
    lng: z.number(),
  })
  .openapi("Town");

export const TownListResponse = z
  .object({ towns: z.array(TownSchema) })
  .openapi("TownListResponse");

export const TownDetailResponse = z
  .object({ town: TownSchema })
  .openapi("TownDetailResponse");

// ---- Doodies -------------------------------------------------------

export const DoodieListItem = z
  .object({
    id: z.string(),
    slug: z.string(),
    type: DoodieType,
    description: z.string(),
    disability_related: z.boolean(),
    lat: z.number().nullable(),
    lng: z.number().nullable(),
    upvotes_count: z.number().int(),
    downvotes_count: z.number().int(),
    comments_count: z.number().int(),
    created_at: z.string(),
    reporter: z.object({ screen_name: z.string().nullable() }),
    image_count: z.number().int(),
    first_image_url: z.string().nullable(),
  })
  .openapi("DoodieListItem");

export const DoodieListResponse = z
  .object({
    doodies: z.array(DoodieListItem),
    page: z.number().int(),
    page_size: z.number().int(),
    total: z.number().int(),
    sort: z.enum(["recent", "top"]),
  })
  .openapi("DoodieListResponse");

export const DoodieImageRef = z
  .object({ position: z.number().int(), url: z.string() })
  .openapi("DoodieImageRef");

export const DoodieDetail = z
  .object({
    id: z.string(),
    slug: z.string(),
    type: DoodieType,
    description: z.string(),
    disability_related: z.boolean(),
    lat: z.number().nullable(),
    lng: z.number().nullable(),
    upvotes_count: z.number().int(),
    downvotes_count: z.number().int(),
    comments_count: z.number().int(),
    moderation_status: ModerationStatus,
    created_at: z.string(),
    updated_at: z.string(),
    town: z.object({ slug: z.string(), name: z.string() }),
    reporter: z.object({ screen_name: z.string() }),
    images: z.array(DoodieImageRef),
  })
  .openapi("DoodieDetail");

export const DoodieDetailResponse = z
  .object({ doodie: DoodieDetail })
  .openapi("DoodieDetailResponse");

export const DoodieCreateMultipart = z
  .object({
    type: DoodieType,
    description: z.string().min(1).max(500),
    disability_related: z.string().optional().openapi({ description: "'1' for true, '0' (default) for false" }),
    lat: z.string().optional(),
    lng: z.string().optional(),
    images: z.array(z.any()).optional().openapi({
      type: "array",
      items: { type: "string", format: "binary" },
      description: "Up to 4 image files (JPEG, PNG, or WebP; ≤5 MB each)",
    }),
  })
  .openapi("DoodieCreateMultipart");

export const DoodieCreateResponse = z
  .object({
    id: z.string(),
    slug: z.string(),
    town_slug: z.string(),
    url: z.string(),
    image_count: z.number().int(),
  })
  .openapi("DoodieCreateResponse");

export const DoodieUpdateRequest = z
  .object({
    description: z.string().min(1).max(500).optional(),
    disability_related: z.boolean().optional(),
    moderation_status: ModerationStatus.optional().openapi({
      description: "Admin-only field. Non-admins providing this are silently ignored.",
    }),
  })
  .openapi("DoodieUpdateRequest");

// ---- Map dashboard --------------------------------------------------

export const MapPin = z
  .object({
    id: z.string(),
    slug: z.string(),
    type: DoodieType,
    lat: z.number(),
    lng: z.number(),
    upvotes_count: z.number().int(),
    downvotes_count: z.number().int(),
  })
  .openapi("MapPin");

export const MapResponse = z
  .object({ pins: z.array(MapPin) })
  .openapi("MapResponse");

// ---- Votes / Reports ------------------------------------------------

export const VoteRequest = z
  .object({ vote: VoteType.nullable() })
  .openapi("VoteRequest");

export const VoteResponse = z
  .object({
    vote: VoteType.nullable(),
    upvotes_count: z.number().int(),
    downvotes_count: z.number().int(),
  })
  .openapi("VoteResponse");

export const ReportRequest = z
  .object({
    reason: z.string().min(1).max(100),
    details: z.string().max(1000).optional(),
  })
  .openapi("ReportRequest");

// ---- Comments -------------------------------------------------------

export const CommentItem = z
  .object({
    id: z.string(),
    doodie_id: z.string(),
    author: z.object({ screen_name: z.string() }),
    body: z.string(),
    upvotes_count: z.number().int(),
    downvotes_count: z.number().int(),
    censored: z.boolean(),
    created_at: z.string(),
  })
  .openapi("Comment");

export const CommentListResponse = z
  .object({
    comments: z.array(CommentItem),
    page: z.number().int(),
    page_size: z.number().int(),
    total: z.number().int(),
  })
  .openapi("CommentListResponse");

export const CommentCreateRequest = z
  .object({ body: z.string().min(1).max(1000) })
  .openapi("CommentCreateRequest");

export const CommentCreateResponse = z
  .object({ id: z.string() })
  .openapi("CommentCreateResponse");

export const CommentCensorRequest = z
  .object({ censored: z.boolean() })
  .openapi("CommentCensorRequest");

// ---- Profile --------------------------------------------------------

export const LinkedAccount = z
  .object({
    provider: z.string(),
    account_id: z.string(),
    linked_at: z.string(),
  })
  .openapi("LinkedAccount");

export const ProfileUser = z
  .object({
    id: z.string(),
    name: z.string(),
    email: z.string(),
    image: z.string().nullable(),
    screen_name: z.string().nullable(),
    screen_name_suggestion: z.string().nullable(),
    city: z.string().nullable(),
    state_or_region: z.string().nullable(),
    country: z.string().nullable(),
    brownie_points: z.number().int(),
    status: UserStatus,
    terms_accepted_at: z.string().nullable(),
    created_at: z.string().nullable(),
    profile_complete: z.boolean(),
    accounts: z.array(LinkedAccount),
  })
  .openapi("ProfileUser");

export const ProfileResponse = z
  .object({ user: ProfileUser })
  .openapi("ProfileResponse");

export const ProfileUpdateRequest = z
  .object({
    city: z.string().nullable().optional(),
    state_or_region: z.string().nullable().optional(),
    country: z.string().length(2).nullable().optional().openapi({ description: "ISO 3166-1 alpha-2 country code" }),
  })
  .openapi("ProfileUpdateRequest");

export const ScreenNameCheckResponse = z
  .union([
    z.object({ available: z.literal(true) }),
    z.object({
      available: z.literal(false),
      reason: z.enum(["invalid", "taken"]),
      message: z.string(),
    }),
  ])
  .openapi("ScreenNameCheckResponse");

export const ScreenNameSuggestResponse = z
  .object({ suggestion: z.string() })
  .openapi("ScreenNameSuggestResponse");

export const ScreenNameSetRequest = z
  .object({ screen_name: z.string().min(3).max(30) })
  .openapi("ScreenNameSetRequest");

export const ScreenNameSetResponse = z
  .object({ ok: z.boolean(), screen_name: z.string() })
  .openapi("ScreenNameSetResponse");

// ---- Admin ----------------------------------------------------------

export const AdminReportItem = z
  .object({
    id: z.string(),
    target_type: ReportTargetType,
    target_id: z.string(),
    reporter_id: z.string(),
    reporter_screen_name: z.string().nullable(),
    reason: z.string(),
    details: z.string().nullable(),
    status: ReportStatus,
    reviewed_at: z.string().nullable(),
    reviewer_notes: z.string().nullable(),
    created_at: z.string(),
  })
  .openapi("AdminReportItem");

export const AdminReportsResponse = z
  .object({
    reports: z.array(AdminReportItem),
    page: z.number().int(),
    page_size: z.number().int(),
    total: z.number().int(),
  })
  .openapi("AdminReportsResponse");

export const AdminReportPatchRequest = z
  .object({
    status: ReportStatus,
    reviewer_notes: z.string().max(1000).optional(),
  })
  .openapi("AdminReportPatchRequest");

export const AdminUserItem = z
  .object({
    id: z.string(),
    name: z.string(),
    email: z.string(),
    screen_name: z.string().nullable(),
    country: z.string().nullable(),
    brownie_points: z.number().int(),
    status: UserStatus,
    createdAt: z.string(),
  })
  .openapi("AdminUserItem");

export const AdminUsersResponse = z
  .object({
    users: z.array(AdminUserItem),
    page: z.number().int(),
    page_size: z.number().int(),
    total: z.number().int(),
  })
  .openapi("AdminUsersResponse");

export const AdminUserDetailResponse = z
  .object({
    user: AdminUserItem.extend({
      city: z.string().nullable(),
      state_or_region: z.string().nullable(),
      terms_accepted_at: z.string().nullable(),
    }),
    accounts: z.array(
      z.object({
        providerId: z.string(),
        accountId: z.string(),
        createdAt: z.string(),
      })
    ),
    recent_sessions: z.array(
      z.object({
        id: z.string(),
        ipAddress: z.string().nullable(),
        userAgent: z.string().nullable(),
        createdAt: z.string(),
        expiresAt: z.string(),
      })
    ),
  })
  .openapi("AdminUserDetailResponse");

export const AdminUserPatchRequest = z
  .object({
    status: UserStatus.optional(),
    brownie_points_delta: z.number().int().optional(),
    reason: z.string().max(500).optional(),
  })
  .openapi("AdminUserPatchRequest");

export const AdminUserPatchResponse = z
  .object({
    ok: z.boolean(),
    changed: z.boolean(),
    actor: z.object({ id: z.string() }).optional(),
    audit: z.record(z.string(), z.any()).optional(),
  })
  .openapi("AdminUserPatchResponse");
