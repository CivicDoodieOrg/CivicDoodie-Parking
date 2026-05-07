// OpenAPI route declarations. Purely declarative — actual handlers live in
// src/routes/*.ts. The for-loop in src/index.ts registers every export from
// this file via app.openAPIRegistry.registerPath.
//
// Path params use OpenAPI {curly} syntax. Hono's :param syntax in the
// handler files is matched against this at registration time only by route
// shape, not literal string equality.

import { createRoute, z } from "@hono/zod-openapi";
import {
  ErrorSchema,
  OkSchema,
  ChangedOkSchema,
  HealthSchema,
  TownSlugParam,
  DoodieSlugParam,
  PositionParam,
  IdParam,
  CommentIdParam,
  TownListResponse,
  TownDetailResponse,
  DoodieType,
  ReportStatus,
  UserStatus,
  DoodieListResponse,
  DoodieDetailResponse,
  DoodieCreateMultipart,
  DoodieCreateResponse,
  DoodieUpdateRequest,
  MapResponse,
  VoteRequest,
  VoteResponse,
  ReportRequest,
  CommentListResponse,
  CommentCreateRequest,
  CommentCreateResponse,
  CommentCensorRequest,
  ProfileResponse,
  ProfileUpdateRequest,
  ScreenNameCheckResponse,
  ScreenNameSuggestResponse,
  ScreenNameSetRequest,
  ScreenNameSetResponse,
  AdminReportsResponse,
  AdminReportPatchRequest,
  AdminUsersResponse,
  AdminUserDetailResponse,
  AdminUserPatchRequest,
  AdminUserPatchResponse,
} from "./schemas";

const json = (schema: z.ZodTypeAny) => ({
  "application/json": { schema },
});

// --- Health ---------------------------------------------------------

export const healthRoute = createRoute({
  method: "get",
  path: "/api/health",
  tags: ["Health"],
  summary: "Health check",
  responses: {
    200: { description: "OK", content: json(HealthSchema) },
  },
});

// --- Towns ----------------------------------------------------------

export const listTownsRoute = createRoute({
  method: "get",
  path: "/api/towns",
  tags: ["Towns"],
  summary: "List towns",
  description: "Alphabetical list of all known towns. Use ?q= for a name/slug prefix match (case-insensitive).",
  request: {
    query: z.object({
      q: z.string().optional().openapi({ description: "Prefix match on name or slug, case-insensitive." }),
      limit: z.coerce.number().int().min(1).max(500).optional(),
    }),
  },
  responses: {
    200: { description: "Town list", content: json(TownListResponse) },
  },
});

export const getTownRoute = createRoute({
  method: "get",
  path: "/api/towns/{slug}",
  tags: ["Towns"],
  summary: "Get a town by slug",
  request: {
    params: z.object({
      slug: z.string().openapi({ param: { name: "slug", in: "path" }, example: "boston-ma" }),
    }),
  },
  responses: {
    200: { description: "Town", content: json(TownDetailResponse) },
    404: { description: "Town not found", content: json(ErrorSchema) },
  },
});

// --- Doodies --------------------------------------------------------

export const listDoodiesRoute = createRoute({
  method: "get",
  path: "/api/towns/{townSlug}/doodies",
  tags: ["Doodies"],
  summary: "List Doodies in a town",
  description: "Public list of approved Doodies. Pending/flagged/removed are hidden.",
  request: {
    params: z.object({ townSlug: TownSlugParam }),
    query: z.object({
      sort: z.enum(["recent", "top"]).optional().openapi({ description: "Default: recent" }),
      type: DoodieType.optional(),
      page: z.coerce.number().int().min(1).optional(),
      page_size: z.coerce.number().int().min(1).max(50).optional(),
    }),
  },
  responses: {
    200: { description: "Doodie list", content: json(DoodieListResponse) },
    404: { description: "Town not found", content: json(ErrorSchema) },
  },
});

export const createDoodieRoute = createRoute({
  method: "post",
  path: "/api/towns/{townSlug}/doodies",
  tags: ["Doodies"],
  summary: "File a new Doodie",
  description:
    "Create a new Doodie report with up to 4 image attachments. " +
    "Requires authenticated user with completed profile (screen_name, country, ToS accepted).",
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ townSlug: TownSlugParam }),
    body: { content: { "multipart/form-data": { schema: DoodieCreateMultipart } } },
  },
  responses: {
    201: { description: "Created", content: json(DoodieCreateResponse) },
    400: { description: "Invalid input", content: json(ErrorSchema) },
    401: { description: "Unauthorized", content: json(ErrorSchema) },
    404: { description: "Town not found", content: json(ErrorSchema) },
    412: { description: "Profile not complete", content: json(ErrorSchema) },
    429: { description: "Rate limit exceeded", content: json(ErrorSchema) },
  },
});

export const getDoodieRoute = createRoute({
  method: "get",
  path: "/api/towns/{townSlug}/doodies/{doodieSlug}",
  tags: ["Doodies"],
  summary: "Get a Doodie",
  description: "Approved Doodies are public. Pending/flagged are visible only to the reporter or an admin. Removed is admin-only. All hidden cases return 404 (not 403).",
  request: {
    params: z.object({ townSlug: TownSlugParam, doodieSlug: DoodieSlugParam }),
  },
  responses: {
    200: { description: "Doodie detail", content: json(DoodieDetailResponse) },
    404: { description: "Not found / hidden", content: json(ErrorSchema) },
  },
});

export const getDoodieImageRoute = createRoute({
  method: "get",
  path: "/api/towns/{townSlug}/doodies/{doodieSlug}/images/{position}",
  tags: ["Doodies"],
  summary: "Fetch a Doodie image",
  description: "Returns image bytes proxied from R2. Same visibility rules as the metadata endpoint. Cached for 1 hour.",
  request: {
    params: z.object({
      townSlug: TownSlugParam,
      doodieSlug: DoodieSlugParam,
      position: PositionParam,
    }),
  },
  responses: {
    200: {
      description: "Image bytes",
      content: {
        "image/jpeg": { schema: z.any() },
        "image/png": { schema: z.any() },
        "image/webp": { schema: z.any() },
      },
    },
    404: { description: "Not found", content: json(ErrorSchema) },
  },
});

export const updateDoodieRoute = createRoute({
  method: "patch",
  path: "/api/towns/{townSlug}/doodies/{doodieSlug}",
  tags: ["Doodies"],
  summary: "Update a Doodie",
  description: "Owner can update description and disability_related. Admin can additionally set moderation_status.",
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ townSlug: TownSlugParam, doodieSlug: DoodieSlugParam }),
    body: { content: json(DoodieUpdateRequest) },
  },
  responses: {
    200: { description: "Updated", content: json(ChangedOkSchema) },
    400: { description: "Invalid input", content: json(ErrorSchema) },
    401: { description: "Unauthorized", content: json(ErrorSchema) },
    404: { description: "Not found / not owner", content: json(ErrorSchema) },
  },
});

export const deleteDoodieRoute = createRoute({
  method: "delete",
  path: "/api/towns/{townSlug}/doodies/{doodieSlug}",
  tags: ["Doodies"],
  summary: "Delete a Doodie",
  description: "Owner or admin. Deletes the row, cascades to images / votes / comments / audit, and best-effort removes images from R2.",
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ townSlug: TownSlugParam, doodieSlug: DoodieSlugParam }),
  },
  responses: {
    200: { description: "Deleted", content: json(OkSchema) },
    401: { description: "Unauthorized", content: json(ErrorSchema) },
    404: { description: "Not found / not owner", content: json(ErrorSchema) },
  },
});

export const voteDoodieRoute = createRoute({
  method: "post",
  path: "/api/towns/{townSlug}/doodies/{doodieSlug}/vote",
  tags: ["Doodies"],
  summary: "Vote on a Doodie",
  description: "Toggle/switch your vote. Only allowed on approved Doodies and not on your own. Pass `vote: null` to remove an existing vote.",
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ townSlug: TownSlugParam, doodieSlug: DoodieSlugParam }),
    body: { content: json(VoteRequest) },
  },
  responses: {
    200: { description: "New state", content: json(VoteResponse) },
    400: { description: "Self-vote / not approved", content: json(ErrorSchema) },
    401: { description: "Unauthorized", content: json(ErrorSchema) },
    404: { description: "Not found", content: json(ErrorSchema) },
    412: { description: "Profile not complete", content: json(ErrorSchema) },
  },
});

export const reportDoodieRoute = createRoute({
  method: "post",
  path: "/api/towns/{townSlug}/doodies/{doodieSlug}/report",
  tags: ["Doodies"],
  summary: "Report a Doodie",
  description: "File an abuse report. Cannot report your own Doodie. Rate-limited to 5 per hour per user.",
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ townSlug: TownSlugParam, doodieSlug: DoodieSlugParam }),
    body: { content: json(ReportRequest) },
  },
  responses: {
    200: { description: "Report filed", content: json(OkSchema) },
    400: { description: "Self-report / missing reason", content: json(ErrorSchema) },
    401: { description: "Unauthorized", content: json(ErrorSchema) },
    404: { description: "Not found", content: json(ErrorSchema) },
    429: { description: "Rate limit exceeded", content: json(ErrorSchema) },
  },
});

// --- Dashboard ------------------------------------------------------

export const dashboardMapRoute = createRoute({
  method: "get",
  path: "/api/towns/{townSlug}/dashboard/map",
  tags: ["Dashboard"],
  summary: "Map pin payload",
  description: "Thin payload of approved + located Doodies for client-side map rendering and clustering.",
  request: { params: z.object({ townSlug: TownSlugParam }) },
  responses: {
    200: { description: "Pins", content: json(MapResponse) },
    404: { description: "Town not found", content: json(ErrorSchema) },
  },
});

// --- Comments -------------------------------------------------------

export const listCommentsRoute = createRoute({
  method: "get",
  path: "/api/towns/{townSlug}/doodies/{doodieSlug}/comments",
  tags: ["Comments"],
  summary: "List comments",
  description: "Comments on a Doodie. Censored bodies are masked as `[censored]` for non-admins.",
  request: {
    params: z.object({ townSlug: TownSlugParam, doodieSlug: DoodieSlugParam }),
    query: z.object({
      page: z.coerce.number().int().min(1).optional(),
      page_size: z.coerce.number().int().min(1).max(100).optional(),
    }),
  },
  responses: {
    200: { description: "Comment list", content: json(CommentListResponse) },
    404: { description: "Doodie not found", content: json(ErrorSchema) },
  },
});

export const createCommentRoute = createRoute({
  method: "post",
  path: "/api/towns/{townSlug}/doodies/{doodieSlug}/comments",
  tags: ["Comments"],
  summary: "Post a comment",
  description: "Comments are 1–1000 chars and only allowed on approved Doodies.",
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ townSlug: TownSlugParam, doodieSlug: DoodieSlugParam }),
    body: { content: json(CommentCreateRequest) },
  },
  responses: {
    201: { description: "Created", content: json(CommentCreateResponse) },
    400: { description: "Invalid body / not approved", content: json(ErrorSchema) },
    401: { description: "Unauthorized", content: json(ErrorSchema) },
    404: { description: "Doodie not found", content: json(ErrorSchema) },
    412: { description: "Profile not complete", content: json(ErrorSchema) },
  },
});

export const voteCommentRoute = createRoute({
  method: "post",
  path: "/api/comments/{commentId}/vote",
  tags: ["Comments"],
  summary: "Vote on a comment",
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ commentId: CommentIdParam }),
    body: { content: json(VoteRequest) },
  },
  responses: {
    200: { description: "New state", content: json(VoteResponse) },
    400: { description: "Self-vote / parent not approved", content: json(ErrorSchema) },
    401: { description: "Unauthorized", content: json(ErrorSchema) },
    404: { description: "Not found", content: json(ErrorSchema) },
    412: { description: "Profile not complete", content: json(ErrorSchema) },
  },
});

export const reportCommentRoute = createRoute({
  method: "post",
  path: "/api/comments/{commentId}/report",
  tags: ["Comments"],
  summary: "Report a comment",
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ commentId: CommentIdParam }),
    body: { content: json(ReportRequest) },
  },
  responses: {
    200: { description: "Report filed", content: json(OkSchema) },
    400: { description: "Self-report", content: json(ErrorSchema) },
    401: { description: "Unauthorized", content: json(ErrorSchema) },
    404: { description: "Not found", content: json(ErrorSchema) },
    429: { description: "Rate limit exceeded", content: json(ErrorSchema) },
  },
});

export const censorCommentRoute = createRoute({
  method: "patch",
  path: "/api/comments/{commentId}",
  tags: ["Comments"],
  summary: "Toggle comment censoring (admin)",
  description: "Hides the body for non-admins; row remains visible so the act is acknowledged.",
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ commentId: CommentIdParam }),
    body: { content: json(CommentCensorRequest) },
  },
  responses: {
    200: { description: "Updated", content: json(z.object({ ok: z.boolean(), changed: z.boolean(), censored: z.boolean().optional() })) },
    400: { description: "Invalid input", content: json(ErrorSchema) },
    404: { description: "Not found / not admin", content: json(ErrorSchema) },
  },
});

export const deleteCommentRoute = createRoute({
  method: "delete",
  path: "/api/comments/{commentId}",
  tags: ["Comments"],
  summary: "Delete a comment",
  description: "Owner or admin. Hard delete, cascades to votes.",
  security: [{ bearerAuth: [] }],
  request: { params: z.object({ commentId: CommentIdParam }) },
  responses: {
    200: { description: "Deleted", content: json(OkSchema) },
    401: { description: "Unauthorized", content: json(ErrorSchema) },
    404: { description: "Not found / not owner", content: json(ErrorSchema) },
  },
});

// --- Profile --------------------------------------------------------

export const getProfileRoute = createRoute({
  method: "get",
  path: "/api/profile",
  tags: ["Profile"],
  summary: "Get the authenticated user's full profile",
  description: "Includes private fields (email, linked OAuth accounts) — only the user themselves can call this.",
  security: [{ bearerAuth: [] }],
  responses: {
    200: { description: "Profile", content: json(ProfileResponse) },
    401: { description: "Unauthorized", content: json(ErrorSchema) },
  },
});

export const patchProfileRoute = createRoute({
  method: "patch",
  path: "/api/profile",
  tags: ["Profile"],
  summary: "Update profile location fields",
  security: [{ bearerAuth: [] }],
  request: { body: { content: json(ProfileUpdateRequest) } },
  responses: {
    200: { description: "Updated", content: json(OkSchema) },
    400: { description: "Invalid country code", content: json(ErrorSchema) },
    401: { description: "Unauthorized", content: json(ErrorSchema) },
  },
});

export const checkScreenNameRoute = createRoute({
  method: "get",
  path: "/api/profile/screen-name/check",
  tags: ["Profile"],
  summary: "Check screen name availability",
  description: "Live availability check used by the onboarding form. Validates strictly (no silent corrections) and looks up case-insensitively.",
  security: [{ bearerAuth: [] }],
  request: {
    query: z.object({
      name: z.string().openapi({ description: "The screen name candidate to check" }),
    }),
  },
  responses: {
    200: { description: "Verdict (always 200; body indicates availability)", content: json(ScreenNameCheckResponse) },
    401: { description: "Unauthorized", content: json(ErrorSchema) },
  },
});

export const suggestScreenNameRoute = createRoute({
  method: "get",
  path: "/api/profile/screen-name/suggest",
  tags: ["Profile"],
  summary: "Get a fresh random screen-name suggestion",
  description: "Returns an adj-noun-num combo never derived from the user's display name.",
  security: [{ bearerAuth: [] }],
  responses: {
    200: { description: "Suggestion", content: json(ScreenNameSuggestResponse) },
    401: { description: "Unauthorized", content: json(ErrorSchema) },
  },
});

export const setScreenNameRoute = createRoute({
  method: "post",
  path: "/api/profile/screen-name",
  tags: ["Profile"],
  summary: "Claim a screen name (one-time, immutable)",
  description: "Sets the user's permanent public handle. Once set, can't be changed; subsequent calls return 409.",
  security: [{ bearerAuth: [] }],
  request: { body: { content: json(ScreenNameSetRequest) } },
  responses: {
    200: { description: "Claimed", content: json(ScreenNameSetResponse) },
    400: { description: "Invalid name", content: json(ErrorSchema) },
    401: { description: "Unauthorized", content: json(ErrorSchema) },
    409: { description: "Already set / already taken (case-insensitive)", content: json(ErrorSchema) },
  },
});

export const acceptTermsRoute = createRoute({
  method: "post",
  path: "/api/profile/accept-terms",
  tags: ["Profile"],
  summary: "Accept the Terms of Service",
  security: [{ bearerAuth: [] }],
  responses: {
    200: { description: "Recorded", content: json(OkSchema) },
    401: { description: "Unauthorized", content: json(ErrorSchema) },
  },
});

// --- Admin ----------------------------------------------------------

export const adminListReportsRoute = createRoute({
  method: "get",
  path: "/api/admin/reports",
  tags: ["Admin"],
  summary: "List reports",
  description: "Moderation queue. Returns 404 to non-admins so endpoint existence isn't leaked.",
  security: [{ bearerAuth: [] }],
  request: {
    query: z.object({
      status: ReportStatus.optional(),
      page: z.coerce.number().int().min(1).optional(),
      page_size: z.coerce.number().int().min(1).max(100).optional(),
    }),
  },
  responses: {
    200: { description: "Report list", content: json(AdminReportsResponse) },
    404: { description: "Not admin (also returned when not authenticated)", content: json(ErrorSchema) },
  },
});

export const adminPatchReportRoute = createRoute({
  method: "patch",
  path: "/api/admin/reports/{id}",
  tags: ["Admin"],
  summary: "Resolve a report",
  description: "Set the status (reviewed / actioned / dismissed) and optionally attach reviewer notes.",
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ id: IdParam }),
    body: { content: json(AdminReportPatchRequest) },
  },
  responses: {
    200: { description: "Updated", content: json(OkSchema) },
    400: { description: "Invalid status", content: json(ErrorSchema) },
    404: { description: "Not found / not admin", content: json(ErrorSchema) },
  },
});

export const adminListUsersRoute = createRoute({
  method: "get",
  path: "/api/admin/users",
  tags: ["Admin"],
  summary: "List users",
  description: "Returns full rows including email and brownie_points. Filter by status; search by screen_name/email prefix or exact id.",
  security: [{ bearerAuth: [] }],
  request: {
    query: z.object({
      status: UserStatus.optional(),
      q: z.string().optional(),
      page: z.coerce.number().int().min(1).optional(),
      page_size: z.coerce.number().int().min(1).max(100).optional(),
    }),
  },
  responses: {
    200: { description: "User list", content: json(AdminUsersResponse) },
    404: { description: "Not admin", content: json(ErrorSchema) },
  },
});

export const adminGetUserRoute = createRoute({
  method: "get",
  path: "/api/admin/users/{id}",
  tags: ["Admin"],
  summary: "Get a user (admin-only fuller view)",
  description: "Includes linked OAuth accounts and the last 10 sessions (with IP and user agent) for moderation context.",
  security: [{ bearerAuth: [] }],
  request: { params: z.object({ id: IdParam }) },
  responses: {
    200: { description: "User detail", content: json(AdminUserDetailResponse) },
    404: { description: "Not found / not admin", content: json(ErrorSchema) },
  },
});

export const adminPatchUserRoute = createRoute({
  method: "patch",
  path: "/api/admin/users/{id}",
  tags: ["Admin"],
  summary: "Moderate a user",
  description: "Change the user's status and/or adjust brownie_points. brownie_points is clamped at 0 on the floor.",
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ id: IdParam }),
    body: { content: json(AdminUserPatchRequest) },
  },
  responses: {
    200: { description: "Updated (with audit-shaped diff)", content: json(AdminUserPatchResponse) },
    400: { description: "Invalid status", content: json(ErrorSchema) },
    404: { description: "Not found / not admin", content: json(ErrorSchema) },
  },
});
