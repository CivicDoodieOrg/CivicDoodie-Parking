import { Hono } from "hono";
import { requireAuth } from "../middleware/auth";
import { createAuth, type AuthEnv } from "../auth";
import { generateSlug } from "../lib/slug";
import {
  MAX_IMAGES,
  deleteImages,
  storeImage,
  validateImageUpload,
} from "../lib/r2";

type Env = {
  Bindings: AuthEnv & {
    DB: D1Database;
    IMAGES: R2Bucket;
    ASSETS: Fetcher;
    ADMIN_USER_IDS: string;
  };
  Variables: {
    user: { id: string; email: string; name: string; image?: string | null };
    session: { id: string; userId: string; expiresAt: Date };
  };
};

const VALID_TYPES = ["enforcement", "meter", "garage"] as const;
type DoodieType = (typeof VALID_TYPES)[number];

const DESCRIPTION_MAX = 500;

// Mounted at /api/towns/:townSlug/doodies — :townSlug is available via param().
export const doodies = new Hono<Env>();

// Helpers ---------------------------------------------------------------

function isAdmin(user: { id: string }, adminEnv: string | undefined): boolean {
  const ids = (adminEnv || "").split(",").map((s) => s.trim()).filter(Boolean);
  return ids.includes(user.id);
}

function single(v: unknown): string {
  if (Array.isArray(v)) return typeof v[0] === "string" ? v[0] : "";
  if (typeof v === "string") return v;
  return "";
}

// Profile-complete gate — required before any user-generated contribution
// (filing, voting, reporting, commenting). Returns an error string or null.
async function profileGate(db: D1Database, userId: string): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT screen_name, country, terms_accepted_at FROM "user" WHERE id = ?`
    )
    .bind(userId)
    .first<{
      screen_name: string | null;
      country: string | null;
      terms_accepted_at: string | null;
    }>();
  if (!row?.screen_name) return "Pick a screen name first.";
  if (!row.country) return "Set your country before contributing.";
  if (!row.terms_accepted_at)
    return "Accept the Terms of Service before contributing.";
  return null;
}

function ipOf(c: { req: { header: (n: string) => string | undefined } }): string | null {
  return (
    c.req.header("cf-connecting-ip") ||
    c.req.header("x-forwarded-for") ||
    null
  );
}

async function loadTown(db: D1Database, slug: string) {
  return db
    .prepare(`SELECT id, slug, name, state_or_region, country FROM town WHERE slug = ?`)
    .bind(slug)
    .first<{
      id: string;
      slug: string;
      name: string;
      state_or_region: string | null;
      country: string;
    }>();
}

function townSlugFrom(city: string, state: string): string {
  return `${city}-${state}`
    .toLowerCase()
    .normalize("NFD").replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

type FixState = "unresolved" | "investigating" | "resolved_unconfirmed";

interface DoodieRow {
  id: string;
  slug: string;
  town_id: string;
  reporter_id: string;
  type: DoodieType;
  description: string;
  disability_related: number;
  lat: number | null;
  lng: number | null;
  upvotes_count: number;
  downvotes_count: number;
  comments_count: number;
  report_count: number;
  last_reported_at: string;
  fix_state: FixState;
  moderation_status: "pending" | "approved" | "flagged" | "removed";
  created_at: string;
  updated_at: string;
}

async function loadDoodie(
  db: D1Database,
  townId: string,
  slug: string
): Promise<DoodieRow | null> {
  return db
    .prepare(
      `SELECT id, slug, town_id, reporter_id, type, description, disability_related,
              lat, lng, upvotes_count, downvotes_count, comments_count,
              report_count, last_reported_at, fix_state,
              moderation_status, created_at, updated_at
       FROM doodie
       WHERE town_id = ? AND slug = ?`
    )
    .bind(townId, slug)
    .first<DoodieRow>();
}

function canSeeDoodie(
  viewerId: string | null,
  doodie: Pick<DoodieRow, "reporter_id" | "moderation_status">,
  viewerIsAdmin: boolean
): boolean {
  if (doodie.moderation_status === "approved") return true;
  if (doodie.moderation_status === "removed" && !viewerIsAdmin) return false;
  if (!viewerId) return false;
  // null reporter_id means anonymous — no authenticated viewer can claim ownership
  if (doodie.reporter_id && viewerId === doodie.reporter_id) return true;
  return viewerIsAdmin;
}

// Public-facing shape — never include reporter_id, reporter_ip, or audit data.
function publicDoodie(
  d: DoodieRow,
  town: { slug: string; name: string },
  reporter_screen_name: string,
  images: { position: number; url: string }[]
) {
  return {
    id: d.id,
    slug: d.slug,
    type: d.type,
    description: d.description,
    disability_related: Boolean(d.disability_related),
    lat: d.lat,
    lng: d.lng,
    upvotes_count: d.upvotes_count,
    downvotes_count: d.downvotes_count,
    comments_count: d.comments_count,
    report_count: d.report_count,
    last_reported_at: d.last_reported_at,
    fix_state: d.fix_state,
    moderation_status: d.moderation_status,
    created_at: d.created_at,
    updated_at: d.updated_at,
    town: { slug: town.slug, name: town.name },
    reporter: { screen_name: reporter_screen_name },
    images,
  };
}

function imageUrl(townSlug: string, doodieSlug: string, position: number) {
  return `/api/towns/${townSlug}/doodies/${doodieSlug}/images/${position}`;
}

// POST /api/towns/:townSlug/doodies — file a new Doodie ----------------
// Auth is optional — anonymous submissions are allowed for low friction.
// If a valid session exists the reporter_id is recorded; otherwise null.

doodies.post("/", async (c) => {
  let userId: string | null = null;
  try {
    const auth = createAuth(c.env.DB, c.env);
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (session) {
      const userRow = await c.env.DB.prepare(
        'SELECT status FROM "user" WHERE id = ?'
      )
        .bind(session.user.id)
        .first<{ status: string }>();
      if (userRow?.status !== "banned" && userRow?.status !== "suspended") {
        userId = session.user.id;
      }
    }
  } catch {
    /* no auth configured or session lookup failed — proceed anonymously */
  }

  const townSlug = c.req.param("townSlug")!;

  // Parse body before the town lookup so town-creation fields are available
  // when the slug doesn't exist yet.
  const body = await c.req.parseBody({ all: true });

  let town = await loadTown(c.env.DB, townSlug);

  if (!town) {
    const autoCity    = single(body.town_city).trim();
    const autoState   = single(body.town_state).trim();
    const autoCountry = single(body.town_country).trim();
    const autoLat     = parseFloat(single(body.town_lat));
    const autoLng     = parseFloat(single(body.town_lng));
    if (
      autoCity && autoState && autoCountry &&
      Number.isFinite(autoLat) && autoLat >= -90 && autoLat <= 90 &&
      Number.isFinite(autoLng) && autoLng >= -180 && autoLng <= 180
    ) {
      const computedSlug = townSlugFrom(autoCity, autoState);
      await c.env.DB.prepare(
        `INSERT OR IGNORE INTO town (id, slug, name, state_or_region, country, lat, lng)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).bind(computedSlug, computedSlug, autoCity, autoState, autoCountry, autoLat, autoLng).run();
      town = await loadTown(c.env.DB, computedSlug);
    }
    if (!town) return c.json({ error: "Town not found" }, 404);
  }
  const type = single(body.type);
  if (!VALID_TYPES.includes(type as DoodieType)) {
    return c.json(
      { error: "type must be one of: enforcement, meter, garage" },
      400
    );
  }
  const description = single(body.description).trim();
  if (description.length < 1 || description.length > DESCRIPTION_MAX) {
    return c.json(
      { error: `description must be 1–${DESCRIPTION_MAX} characters` },
      400
    );
  }
  const disabilityRelated = single(body.disability_related) === "1" ? 1 : 0;

  function parseCoord(raw: string, min: number, max: number): number | null {
    if (!raw) return null;
    const n = parseFloat(raw);
    return Number.isFinite(n) && n >= min && n <= max ? n : null;
  }
  const lat = parseCoord(single(body.lat), -90, 90);
  const lng = parseCoord(single(body.lng), -180, 180);

  // Image extraction + validation.
  const rawImages = body.images;
  const imageFiles: File[] = (
    Array.isArray(rawImages) ? rawImages : rawImages ? [rawImages] : []
  ).filter((x): x is File => x instanceof File && x.size > 0);
  if (imageFiles.length > MAX_IMAGES) {
    return c.json({ error: `At most ${MAX_IMAGES} images.` }, 400);
  }
  const validatedImages: { file: File; mime: string }[] = [];
  for (const f of imageFiles) {
    const { error, mime } = await validateImageUpload(f);
    if (error) return c.json({ error }, 400);
    validatedImages.push({ file: f, mime });
  }

  // Generate ID + unique-per-town slug.
  const doodieId = crypto.randomUUID();
  let slug = "";
  for (let attempt = 0; attempt < 5; attempt++) {
    slug = generateSlug();
    const exists = await c.env.DB.prepare(
      `SELECT 1 FROM doodie WHERE town_id = ? AND slug = ?`
    )
      .bind(town.id, slug)
      .first();
    if (!exists) break;
  }

  const ip =
    c.req.header("cf-connecting-ip") || c.req.header("x-forwarded-for") || null;

  // Upload images first (cheap to retry; if DB batch fails after, R2 has
  // orphans which a future janitor can sweep).
  const imageRecords: {
    id: string;
    position: number;
    r2_key: string;
    mime_type: string;
    size_bytes: number;
  }[] = [];
  for (let i = 0; i < validatedImages.length; i++) {
    const { file, mime } = validatedImages[i];
    const stored = await storeImage(c.env.IMAGES, doodieId, i, file, mime);
    imageRecords.push({ id: crypto.randomUUID(), position: i, ...stored });
  }

  // Atomic D1 batch: doodie + images + audit row.
  const stmts = [
    c.env.DB.prepare(
      `INSERT INTO doodie (id, slug, town_id, reporter_id, type, description,
                           disability_related, lat, lng, reporter_ip, moderation_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved')`
    ).bind(
      doodieId,
      slug,
      town.id,
      userId,
      type,
      description,
      disabilityRelated,
      lat,
      lng,
      ip
    ),
    ...imageRecords.map((img) =>
      c.env.DB.prepare(
        `INSERT INTO doodie_image (id, doodie_id, position, r2_key, mime_type, size_bytes)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(img.id, doodieId, img.position, img.r2_key, img.mime_type, img.size_bytes)
    ),
    c.env.DB.prepare(
      `INSERT INTO doodie_audit (id, doodie_id, actor_id, action, ip_address)
       VALUES (?, ?, ?, 'created', ?)`
    ).bind(crypto.randomUUID(), doodieId, userId, ip),
  ];
  await c.env.DB.batch(stmts);

  return c.json(
    {
      id: doodieId,
      slug,
      town_slug: townSlug,
      url: `/town/${townSlug}/d/${slug}`,
      image_count: imageRecords.length,
    },
    201
  );
});

// GET /api/towns/:townSlug/doodies — list (public) ---------------------

doodies.get("/", async (c) => {
  const townSlug = c.req.param("townSlug")!;
  const town = await loadTown(c.env.DB, townSlug);
  if (!town) return c.json({ error: "Town not found" }, 404);

  const sort = c.req.query("sort") === "top" ? "top" : "recent";
  const typeFilter = c.req.query("type");
  const page = Math.max(1, parseInt(c.req.query("page") ?? "1", 10) || 1);
  const pageSize = Math.min(
    50,
    Math.max(1, parseInt(c.req.query("page_size") ?? "20", 10) || 20)
  );
  const offset = (page - 1) * pageSize;

  const params: (string | number)[] = [town.id];
  let where = `d.town_id = ? AND d.moderation_status = 'approved'`;
  if (typeFilter && VALID_TYPES.includes(typeFilter as DoodieType)) {
    where += ` AND d.type = ?`;
    params.push(typeFilter);
  }
  const orderBy =
    sort === "top"
      ? `d.upvotes_count DESC, d.created_at DESC`
      : `d.created_at DESC`;

  const totalRow = await c.env.DB.prepare(
    `SELECT COUNT(*) as n FROM doodie d WHERE ${where}`
  )
    .bind(...params)
    .first<{ n: number }>();

  const rows = await c.env.DB.prepare(
    `SELECT d.id, d.slug, d.type, d.description, d.disability_related,
            d.lat, d.lng, d.upvotes_count, d.downvotes_count, d.comments_count,
            d.report_count, d.last_reported_at, d.fix_state,
            d.created_at, u.screen_name as reporter_screen_name,
            (SELECT COUNT(*) FROM doodie_image WHERE doodie_id = d.id) as image_count,
            (SELECT position FROM doodie_image WHERE doodie_id = d.id ORDER BY position LIMIT 1) as first_image_pos
     FROM doodie d
     JOIN "user" u ON u.id = d.reporter_id
     WHERE ${where}
     ORDER BY ${orderBy}
     LIMIT ? OFFSET ?`
  )
    .bind(...params, pageSize, offset)
    .all<{
      id: string;
      slug: string;
      type: DoodieType;
      description: string;
      disability_related: number;
      lat: number | null;
      lng: number | null;
      upvotes_count: number;
      downvotes_count: number;
      comments_count: number;
      report_count: number;
      last_reported_at: string;
      fix_state: FixState;
      created_at: string;
      reporter_screen_name: string | null;
      image_count: number;
      first_image_pos: number | null;
    }>();

  const items = (rows.results ?? []).map((r) => ({
    id: r.id,
    slug: r.slug,
    type: r.type,
    description: r.description,
    disability_related: Boolean(r.disability_related),
    lat: r.lat,
    lng: r.lng,
    upvotes_count: r.upvotes_count,
    downvotes_count: r.downvotes_count,
    comments_count: r.comments_count,
    report_count: r.report_count,
    last_reported_at: r.last_reported_at,
    fix_state: r.fix_state,
    created_at: r.created_at,
    reporter: { screen_name: r.reporter_screen_name },
    image_count: r.image_count,
    first_image_url:
      r.first_image_pos !== null
        ? imageUrl(townSlug, r.slug, r.first_image_pos)
        : null,
  }));

  return c.json({
    doodies: items,
    page,
    page_size: pageSize,
    total: totalRow?.n ?? 0,
    sort,
  });
});

// GET /api/towns/:townSlug/doodies/:doodieSlug — single -----------------

doodies.get("/:doodieSlug", async (c) => {
  const townSlug = c.req.param("townSlug")!;
  const doodieSlug = c.req.param("doodieSlug")!;
  const town = await loadTown(c.env.DB, townSlug);
  if (!town) return c.json({ error: "Not found" }, 404);

  const doodie = await loadDoodie(c.env.DB, town.id, doodieSlug);
  if (!doodie) return c.json({ error: "Not found" }, 404);

  // Visibility gate. Best-effort viewer detection — auth is optional here
  // (public doodies are visible to anyone), but we need to check session if
  // present so owners can see their own pending doodies.
  let viewerId: string | null = null;
  let viewerIsAdmin = false;
  try {
    const { createAuth } = await import("../auth");
    const auth = createAuth(c.env.DB, c.env);
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (session) {
      viewerId = session.user.id;
      viewerIsAdmin = isAdmin(session.user, c.env.ADMIN_USER_IDS);
    }
  } catch {
    /* anonymous viewer */
  }
  if (!canSeeDoodie(viewerId, doodie, viewerIsAdmin)) {
    return c.json({ error: "Not found" }, 404);
  }

  const reporter = doodie.reporter_id
    ? await c.env.DB.prepare(`SELECT screen_name FROM "user" WHERE id = ?`)
        .bind(doodie.reporter_id)
        .first<{ screen_name: string | null }>()
    : null;
  const reporterName = doodie.reporter_id
    ? (reporter?.screen_name ?? "(deleted)")
    : "(anonymous)";

  const imgRows = await c.env.DB.prepare(
    `SELECT position FROM doodie_image WHERE doodie_id = ? ORDER BY position`
  )
    .bind(doodie.id)
    .all<{ position: number }>();
  const images = (imgRows.results ?? []).map((r) => ({
    position: r.position,
    url: imageUrl(townSlug, doodie.slug, r.position),
  }));

  return c.json({
    doodie: publicDoodie(doodie, town, reporterName, images),
  });
});

// GET /images/:position — serve image bytes from R2 --------------------

doodies.get("/:doodieSlug/images/:position", async (c) => {
  const townSlug = c.req.param("townSlug")!;
  const doodieSlug = c.req.param("doodieSlug")!;
  const position = parseInt(c.req.param("position")!, 10);
  if (!Number.isInteger(position) || position < 0 || position >= MAX_IMAGES) {
    return c.json({ error: "Not found" }, 404);
  }

  const town = await loadTown(c.env.DB, townSlug);
  if (!town) return c.json({ error: "Not found" }, 404);

  const doodie = await loadDoodie(c.env.DB, town.id, doodieSlug);
  if (!doodie) return c.json({ error: "Not found" }, 404);

  // Same visibility rules as the metadata endpoint — non-approved doodies
  // 404 to non-owners/non-admins so we don't leak attached images.
  let viewerId: string | null = null;
  let viewerIsAdmin = false;
  try {
    const { createAuth } = await import("../auth");
    const auth = createAuth(c.env.DB, c.env);
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (session) {
      viewerId = session.user.id;
      viewerIsAdmin = isAdmin(session.user, c.env.ADMIN_USER_IDS);
    }
  } catch {
    /* anonymous */
  }
  if (!canSeeDoodie(viewerId, doodie, viewerIsAdmin)) {
    return c.json({ error: "Not found" }, 404);
  }

  const img = await c.env.DB.prepare(
    `SELECT r2_key, mime_type FROM doodie_image WHERE doodie_id = ? AND position = ?`
  )
    .bind(doodie.id, position)
    .first<{ r2_key: string; mime_type: string }>();
  if (!img) return c.json({ error: "Not found" }, 404);

  const obj = await c.env.IMAGES.get(img.r2_key);
  if (!obj) return c.json({ error: "Image data missing" }, 404);

  return new Response(obj.body, {
    headers: {
      "Content-Type": img.mime_type,
      "Cache-Control": "public, max-age=3600",
    },
  });
});

// PATCH /api/towns/:townSlug/doodies/:doodieSlug — owner or admin ------

doodies.patch("/:doodieSlug", requireAuth, async (c) => {
  const user = c.get("user");
  const townSlug = c.req.param("townSlug")!;
  const doodieSlug = c.req.param("doodieSlug")!;
  const town = await loadTown(c.env.DB, townSlug);
  if (!town) return c.json({ error: "Not found" }, 404);
  const doodie = await loadDoodie(c.env.DB, town.id, doodieSlug);
  if (!doodie) return c.json({ error: "Not found" }, 404);

  const admin = isAdmin(user, c.env.ADMIN_USER_IDS);
  const isOwner = user.id === doodie.reporter_id;

  // Auditors and admins can edit fix_state; owners can edit their own description.
  const roleRow = await c.env.DB.prepare('SELECT role FROM "user" WHERE id = ?')
    .bind(user.id).first<{ role: string }>();
  const isAuditor = roleRow?.role === "auditor" || roleRow?.role === "admin";

  if (!isOwner && !admin && !isAuditor) return c.json({ error: "Not found" }, 404);

  const body = await c.req
    .json<{
      description?: unknown;
      disability_related?: unknown;
      moderation_status?: unknown;
      fix_state?: unknown;
    }>()
    .catch(() => ({}) as Record<string, unknown>);

  const updates: { col: string; val: string | number | null }[] = [];
  const auditDetails: Record<string, unknown> = {};

  if (typeof body.description === "string") {
    const desc = body.description.trim();
    if (desc.length < 1 || desc.length > DESCRIPTION_MAX) {
      return c.json(
        { error: `description must be 1–${DESCRIPTION_MAX} characters` },
        400
      );
    }
    if (desc !== doodie.description) {
      updates.push({ col: "description", val: desc });
      auditDetails.description = { from: doodie.description, to: desc };
    }
  }
  if (
    typeof body.disability_related === "boolean" ||
    body.disability_related === 0 ||
    body.disability_related === 1
  ) {
    const dr = body.disability_related ? 1 : 0;
    if (dr !== doodie.disability_related) {
      updates.push({ col: "disability_related", val: dr });
      auditDetails.disability_related = { from: doodie.disability_related === 1, to: dr === 1 };
    }
  }
  if (admin && typeof body.moderation_status === "string") {
    const ms = body.moderation_status;
    if (!["pending", "approved", "flagged", "removed"].includes(ms)) {
      return c.json({ error: "invalid moderation_status" }, 400);
    }
    if (ms !== doodie.moderation_status) {
      updates.push({ col: "moderation_status", val: ms });
      auditDetails.moderation_status = { from: doodie.moderation_status, to: ms };
    }
  }
  if ((admin || isAuditor) && typeof body.fix_state === "string") {
    const fs = body.fix_state;
    if (!["unresolved", "investigating", "resolved_unconfirmed"].includes(fs)) {
      return c.json({ error: "invalid fix_state" }, 400);
    }
    if (fs !== doodie.fix_state) {
      updates.push({ col: "fix_state", val: fs });
      auditDetails.fix_state = { from: doodie.fix_state, to: fs };
    }
  }

  if (updates.length === 0) return c.json({ ok: true, changed: false });

  const setClause = updates.map((u) => `${u.col} = ?`).join(", ");
  const ip =
    c.req.header("cf-connecting-ip") || c.req.header("x-forwarded-for") || null;

  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE doodie SET ${setClause}, updated_at = datetime('now') WHERE id = ?`
    ).bind(...updates.map((u) => u.val), doodie.id),
    c.env.DB.prepare(
      `INSERT INTO doodie_audit (id, doodie_id, actor_id, action, details, ip_address)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(
      crypto.randomUUID(),
      doodie.id,
      user.id,
      admin && !isOwner ? "moderated" : isAuditor && !isOwner ? "audited" : "edited",
      JSON.stringify(auditDetails),
      ip
    ),
  ]);

  return c.json({ ok: true, changed: true });
});

// DELETE /api/towns/:townSlug/doodies/:doodieSlug — owner or admin -----

doodies.delete("/:doodieSlug", requireAuth, async (c) => {
  const user = c.get("user");
  const townSlug = c.req.param("townSlug")!;
  const doodieSlug = c.req.param("doodieSlug")!;
  const town = await loadTown(c.env.DB, townSlug);
  if (!town) return c.json({ error: "Not found" }, 404);
  const doodie = await loadDoodie(c.env.DB, town.id, doodieSlug);
  if (!doodie) return c.json({ error: "Not found" }, 404);

  const admin = isAdmin(user, c.env.ADMIN_USER_IDS);
  const isOwner = user.id === doodie.reporter_id;
  if (!isOwner && !admin) return c.json({ error: "Not found" }, 404);

  // Capture image keys for R2 cleanup before cascade-delete drops them.
  const imgRows = await c.env.DB.prepare(
    `SELECT r2_key FROM doodie_image WHERE doodie_id = ?`
  )
    .bind(doodie.id)
    .all<{ r2_key: string }>();
  const r2Keys = (imgRows.results ?? []).map((r) => r.r2_key);

  // FK ON DELETE CASCADE removes images, votes, comments, audit log.
  // Audit history is preserved when the actor is deleted (actor_id ON DELETE
  // SET NULL) but not when the doodie itself goes. Acceptable for MVP.
  await c.env.DB.prepare(`DELETE FROM doodie WHERE id = ?`).bind(doodie.id).run();

  // Best-effort R2 cleanup; orphans are cheap if it fails.
  await deleteImages(c.env.IMAGES, r2Keys);

  return c.json({ ok: true });
});

// POST /:doodieSlug/re-report — "I saw this same problem too" -----------
// Auth is optional. Authenticated users are deduped via doodie_re_report.
// Anonymous users increment the count without a dedup row (user_id NOT NULL
// prevents storing null, so we accept occasional double-counts from anonymous).

doodies.post("/:doodieSlug/re-report", async (c) => {
  let userId: string | null = null;
  try {
    const auth = createAuth(c.env.DB, c.env);
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (session) {
      const userRow = await c.env.DB.prepare('SELECT status FROM "user" WHERE id = ?')
        .bind(session.user.id).first<{ status: string }>();
      if (userRow?.status !== "banned" && userRow?.status !== "suspended") {
        userId = session.user.id;
      }
    }
  } catch { /* anonymous */ }

  const townSlug = c.req.param("townSlug")!;
  const doodieSlug = c.req.param("doodieSlug")!;
  const town = await loadTown(c.env.DB, townSlug);
  if (!town) return c.json({ error: "Not found" }, 404);
  const doodie = await loadDoodie(c.env.DB, town.id, doodieSlug);
  if (!doodie) return c.json({ error: "Not found" }, 404);

  const admin = isAdmin({ id: userId ?? "" }, c.env.ADMIN_USER_IDS);
  if (!canSeeDoodie(userId, doodie, admin)) {
    return c.json({ error: "Not found" }, 404);
  }
  if (userId && doodie.reporter_id && userId === doodie.reporter_id) {
    return c.json({ error: "You filed this Doodie — it already counts as your report." }, 400);
  }
  if (doodie.moderation_status !== "approved") {
    return c.json({ error: "Can only re-report approved Doodies." }, 400);
  }

  const ip = ipOf(c);

  // Dedup for authenticated users only.
  if (userId) {
    const already = await c.env.DB.prepare(
      `SELECT 1 FROM doodie_re_report WHERE doodie_id = ? AND user_id = ?`
    ).bind(doodie.id, userId).first();
    if (already) {
      return c.json({ ok: true, report_count: doodie.report_count, already: true });
    }
  }

  const now = new Date().toISOString().replace("T", " ").slice(0, 19);
  const stmts: D1PreparedStatement[] = [];
  if (userId) {
    stmts.push(
      c.env.DB.prepare(
        `INSERT INTO doodie_re_report (doodie_id, user_id, ip_address) VALUES (?, ?, ?)`
      ).bind(doodie.id, userId, ip)
    );
  }
  stmts.push(
    c.env.DB.prepare(
      `UPDATE doodie SET report_count = report_count + 1, last_reported_at = ?, updated_at = ? WHERE id = ?`
    ).bind(now, now, doodie.id),
    c.env.DB.prepare(
      `INSERT INTO doodie_audit (id, doodie_id, actor_id, action, ip_address) VALUES (?, ?, ?, 're-reported', ?)`
    ).bind(crypto.randomUUID(), doodie.id, userId, ip)
  );
  await c.env.DB.batch(stmts);

  return c.json({ ok: true, report_count: doodie.report_count + 1, already: false });
});

// POST /:doodieSlug/vote — up / down / null (toggle off) ----------------
// Body: { vote: "up" | "down" | null }
// Counts on the doodie row are maintained denormalized in the same batch as
// the vote insert/update/delete so they never drift.

doodies.post("/:doodieSlug/vote", requireAuth, async (c) => {
  const user = c.get("user");
  const townSlug = c.req.param("townSlug")!;
  const doodieSlug = c.req.param("doodieSlug")!;
  const town = await loadTown(c.env.DB, townSlug);
  if (!town) return c.json({ error: "Not found" }, 404);
  const doodie = await loadDoodie(c.env.DB, town.id, doodieSlug);
  if (!doodie) return c.json({ error: "Not found" }, 404);

  const admin = isAdmin(user, c.env.ADMIN_USER_IDS);
  if (!canSeeDoodie(user.id, doodie, admin)) {
    return c.json({ error: "Not found" }, 404);
  }
  if (doodie.reporter_id === user.id) {
    return c.json({ error: "Cannot vote on your own Doodie." }, 400);
  }
  if (doodie.moderation_status !== "approved") {
    return c.json({ error: "Voting is only allowed on approved Doodies." }, 400);
  }

  const gateError = await profileGate(c.env.DB, user.id);
  if (gateError) return c.json({ error: gateError }, 412);

  const body = await c.req
    .json<{ vote?: unknown }>()
    .catch(() => ({}) as { vote?: unknown });
  const requested = body.vote;
  if (
    requested !== "up" &&
    requested !== "down" &&
    requested !== null &&
    requested !== undefined
  ) {
    return c.json({ error: 'vote must be "up", "down", or null' }, 400);
  }
  const newVote: "up" | "down" | null =
    requested === "up" || requested === "down" ? requested : null;

  const existing = await c.env.DB.prepare(
    `SELECT vote_type FROM doodie_vote WHERE doodie_id = ? AND user_id = ?`
  )
    .bind(doodie.id, user.id)
    .first<{ vote_type: "up" | "down" }>();
  const oldVote: "up" | "down" | null = existing?.vote_type ?? null;

  // Idempotent no-op.
  if (oldVote === newVote) {
    return c.json({
      vote: newVote,
      upvotes_count: doodie.upvotes_count,
      downvotes_count: doodie.downvotes_count,
    });
  }

  const upDelta =
    (newVote === "up" ? 1 : 0) - (oldVote === "up" ? 1 : 0);
  const downDelta =
    (newVote === "down" ? 1 : 0) - (oldVote === "down" ? 1 : 0);

  const stmts = [];
  if (newVote === null) {
    stmts.push(
      c.env.DB.prepare(
        `DELETE FROM doodie_vote WHERE doodie_id = ? AND user_id = ?`
      ).bind(doodie.id, user.id)
    );
  } else if (oldVote === null) {
    stmts.push(
      c.env.DB.prepare(
        `INSERT INTO doodie_vote (doodie_id, user_id, vote_type) VALUES (?, ?, ?)`
      ).bind(doodie.id, user.id, newVote)
    );
  } else {
    stmts.push(
      c.env.DB.prepare(
        `UPDATE doodie_vote SET vote_type = ?, created_at = datetime('now')
         WHERE doodie_id = ? AND user_id = ?`
      ).bind(newVote, doodie.id, user.id)
    );
  }
  stmts.push(
    c.env.DB.prepare(
      `UPDATE doodie SET upvotes_count = upvotes_count + ?,
                          downvotes_count = downvotes_count + ?,
                          updated_at = datetime('now')
       WHERE id = ?`
    ).bind(upDelta, downDelta, doodie.id)
  );
  await c.env.DB.batch(stmts);

  // TODO(phase 5): award/penalize Brownie Points to doodie.reporter_id based
  // on (newVote, oldVote). Defer until karma rules are nailed down.

  return c.json({
    vote: newVote,
    upvotes_count: doodie.upvotes_count + upDelta,
    downvotes_count: doodie.downvotes_count + downDelta,
  });
});

// POST /:doodieSlug/report — file an abuse report --------------------
// Body: { reason: string (1-100), details?: string (<=1000) }
// Allows duplicate reports — abuse caught by the rate-limit (5/hr per user).
// Audit log is written too so the doodie's history shows the report event.

doodies.post("/:doodieSlug/report", requireAuth, async (c) => {
  const user = c.get("user");
  const townSlug = c.req.param("townSlug")!;
  const doodieSlug = c.req.param("doodieSlug")!;
  const town = await loadTown(c.env.DB, townSlug);
  if (!town) return c.json({ error: "Not found" }, 404);
  const doodie = await loadDoodie(c.env.DB, town.id, doodieSlug);
  if (!doodie) return c.json({ error: "Not found" }, 404);

  const admin = isAdmin(user, c.env.ADMIN_USER_IDS);
  if (!canSeeDoodie(user.id, doodie, admin)) {
    return c.json({ error: "Not found" }, 404);
  }
  if (doodie.reporter_id === user.id) {
    return c.json({ error: "Cannot report your own Doodie." }, 400);
  }

  const gateError = await profileGate(c.env.DB, user.id);
  if (gateError) return c.json({ error: gateError }, 412);

  const body = await c.req
    .json<{ reason?: unknown; details?: unknown }>()
    .catch(() => ({}) as Record<string, unknown>);
  const reason =
    typeof body.reason === "string" ? body.reason.trim().slice(0, 100) : "";
  if (reason.length === 0) {
    return c.json({ error: "reason is required" }, 400);
  }
  const details =
    typeof body.details === "string" ? body.details.trim().slice(0, 1000) : null;

  const ip = ipOf(c);
  const reportId = crypto.randomUUID();

  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO report (id, target_type, target_id, reporter_id, reason, details, ip_address)
       VALUES (?, 'doodie', ?, ?, ?, ?, ?)`
    ).bind(reportId, doodie.id, user.id, reason, details, ip),
    c.env.DB.prepare(
      `INSERT INTO doodie_audit (id, doodie_id, actor_id, action, details, ip_address)
       VALUES (?, ?, ?, 'reported', ?, ?)`
    ).bind(
      crypto.randomUUID(),
      doodie.id,
      user.id,
      JSON.stringify({ report_id: reportId, reason }),
      ip
    ),
  ]);

  return c.json({ ok: true });
});
