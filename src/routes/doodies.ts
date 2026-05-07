import { Hono } from "hono";
import { requireAuth } from "../middleware/auth";
import type { AuthEnv } from "../auth";
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
  if (viewerId === doodie.reporter_id) return true;
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

doodies.post("/", requireAuth, async (c) => {
  const user = c.get("user");
  const townSlug = c.req.param("townSlug")!;
  const town = await loadTown(c.env.DB, townSlug);
  if (!town) return c.json({ error: "Town not found" }, 404);

  // Profile completeness gate.
  const userRow = await c.env.DB.prepare(
    `SELECT screen_name, country, terms_accepted_at FROM "user" WHERE id = ?`
  )
    .bind(user.id)
    .first<{
      screen_name: string | null;
      country: string | null;
      terms_accepted_at: string | null;
    }>();
  if (!userRow?.screen_name) {
    return c.json({ error: "Pick a screen name first." }, 412);
  }
  if (!userRow.country) {
    return c.json({ error: "Set your country before filing a Doodie." }, 412);
  }
  if (!userRow.terms_accepted_at) {
    return c.json(
      { error: "Accept the Terms of Service before filing a Doodie." },
      412
    );
  }

  // Parse multipart body.
  const body = await c.req.parseBody({ all: true });
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
  for (const f of imageFiles) {
    const err = validateImageUpload(f);
    if (err) return c.json({ error: err }, 400);
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
  for (let i = 0; i < imageFiles.length; i++) {
    const stored = await storeImage(c.env.IMAGES, doodieId, i, imageFiles[i]);
    imageRecords.push({ id: crypto.randomUUID(), position: i, ...stored });
  }

  // Atomic D1 batch: doodie + images + audit row.
  const stmts = [
    c.env.DB.prepare(
      `INSERT INTO doodie (id, slug, town_id, reporter_id, type, description,
                           disability_related, lat, lng, reporter_ip)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      doodieId,
      slug,
      town.id,
      user.id,
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
    ).bind(crypto.randomUUID(), doodieId, user.id, ip),
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

  const reporter = await c.env.DB.prepare(
    `SELECT screen_name FROM "user" WHERE id = ?`
  )
    .bind(doodie.reporter_id)
    .first<{ screen_name: string | null }>();

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
    doodie: publicDoodie(
      doodie,
      town,
      reporter?.screen_name ?? "(deleted)",
      images
    ),
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
  if (!isOwner && !admin) return c.json({ error: "Not found" }, 404);

  const body = await c.req
    .json<{
      description?: unknown;
      disability_related?: unknown;
      moderation_status?: unknown;
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
      admin && !isOwner ? "moderated" : "edited",
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
