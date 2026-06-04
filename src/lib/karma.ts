// Karma / points engine.
//
// All point rules live here so the economy can be tuned in one place. The
// karma_event table (migration 0009) is the source of truth; user.brownie_points
// is a denormalised cache = SUM(karma_event.points), recomputed after every award.
//
// Awards are idempotent: each carries a dedup_key, and a unique partial index on
// (user_id, dedup_key) turns a repeat award into a no-op. That lets the fix-award
// fan-out fire safely whether a doodie is resolved by an auditor PATCH or by a
// user's clean re-check.

export type KarmaAction =
  | "report"
  | "first_report"
  | "report_fixed"
  | "first_report_fixed"
  | "clean_check"
  | "clean_recheck_fix"
  | "milestone"
  | "admin_adjust";

// Base point values for the six user-earnable actions (decided: tiered / replace —
// these never stack; POST / vs re-report are mutually exclusive events, and a
// doodie's reporter set is {first reporter} ∪ {re-reporters}).
export const POINTS: Record<
  Exclude<KarmaAction, "milestone" | "admin_adjust">,
  number
> = {
  first_report: 2500, // first to report a doodie (creates it)
  report: 500, // re-report an existing doodie ("I saw this too")
  first_report_fixed: 5000, // a doodie you were first to report gets fixed
  report_fixed: 1000, // a doodie you re-reported gets fixed
  clean_recheck_fix: 1500, // you checked a flagged meter, now clean → registers a fix
  clean_check: 50, // you checked a meter and there was no report needed
};

// The six earnable actions, exposed so the profile UI can render a card per
// action with its label and point value without hard-coding the list twice.
export const ACTION_META: {
  action: Exclude<KarmaAction, "milestone" | "admin_adjust">;
  label: string;
}[] = [
  { action: "first_report", label: "First to report" },
  { action: "report", label: "Reports filed" },
  { action: "first_report_fixed", label: "Your first-reports fixed" },
  { action: "report_fixed", label: "Your reports fixed" },
  { action: "clean_recheck_fix", label: "Fixes you registered" },
  { action: "clean_check", label: "Clean checks" },
];

export type MilestoneTrackId =
  | "reports"
  | "first_reports"
  | "fixes"
  | "first_report_fixes"
  | "registered_fixes";

export interface MilestoneTrack {
  id: MilestoneTrackId;
  // Short badge-track name shown as the milestone title.
  label: string;
  // One-line plain-language explanation of exactly what this track counts, so
  // users understand which action advances it.
  description: string;
  // Which ledger action(s) count toward this track's progress. Each track here
  // maps to a single action, but the array shape is kept for flexibility.
  counts: KarmaAction[];
  // Threshold at each level (ascending).
  thresholds: number[];
  // Bonus points awarded when each corresponding level unlocks. DEFAULTS —
  // scaled to each action's rarity/value (rarer/higher-value actions pay more).
  // Intentionally round and easy to tune; lengths must match `thresholds`.
  bonuses: number[];
}

// Five single-action tracks. Common actions (report, report_fixed) use the
// 1/10/25/50 ladder; the rarer prestige actions use 1/5/15/25.
export const MILESTONES: MilestoneTrack[] = [
  {
    id: "reports",
    label: "Reports Filed",
    description: "Reports you added to issues already on the map.",
    counts: ["report"],
    thresholds: [1, 10, 25, 50],
    bonuses: [250, 1000, 3000, 8000],
  },
  {
    id: "first_reports",
    label: "First Reports",
    description: "Issues you were the first to put on the map.",
    counts: ["first_report"],
    thresholds: [1, 5, 15, 25],
    bonuses: [500, 2000, 6000, 15000],
  },
  {
    id: "fixes",
    label: "Reports Fixed",
    description: "Issues you reported that got fixed.",
    counts: ["report_fixed"],
    thresholds: [1, 10, 25, 50],
    bonuses: [500, 2000, 6000, 15000],
  },
  {
    id: "first_report_fixes",
    label: "First Reports Fixed",
    description: "Issues you were first to report that later got fixed.",
    counts: ["first_report_fixed"],
    thresholds: [1, 5, 15, 25],
    bonuses: [1000, 4000, 12000, 30000],
  },
  {
    id: "registered_fixes",
    label: "Fixes Registered",
    description: "Fixes you confirmed by re-checking a flagged meter and finding it clean.",
    counts: ["clean_recheck_fix"],
    thresholds: [1, 5, 15, 25],
    bonuses: [400, 1500, 5000, 12000],
  },
];

export interface AwardInput {
  action: KarmaAction;
  points: number;
  doodieId?: string | null;
  dedupKey?: string | null;
  details?: Record<string, unknown> | null;
}

// Insert one ledger row per award (idempotent via dedup_key), then recompute the
// user's brownie_points cache from the ledger sum. Returns the set of actions that
// actually inserted (i.e. weren't deduped) so callers know whether a milestone
// re-check is worthwhile. No-op for anonymous (null) users.
export async function awardKarma(
  db: D1Database,
  userId: string | null,
  awards: AwardInput[]
): Promise<KarmaAction[]> {
  if (!userId || awards.length === 0) return [];

  const inserted: KarmaAction[] = [];
  for (const a of awards) {
    const res = await db
      .prepare(
        `INSERT OR IGNORE INTO karma_event (id, user_id, action, points, doodie_id, dedup_key, details)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        crypto.randomUUID(),
        userId,
        a.action,
        a.points,
        a.doodieId ?? null,
        a.dedupKey ?? null,
        a.details ? JSON.stringify(a.details) : null
      )
      .run();
    if (res.meta.changes > 0) inserted.push(a.action);
  }

  if (inserted.length > 0) await recomputeTotal(db, userId);
  return inserted;
}

// Recompute the denormalised cache from the ledger. Floor at 0 so a net-negative
// ledger (e.g. heavy admin penalties) never shows a negative public total.
async function recomputeTotal(db: D1Database, userId: string): Promise<void> {
  await db
    .prepare(
      `UPDATE "user"
       SET brownie_points = MAX(0, (SELECT COALESCE(SUM(points), 0) FROM karma_event WHERE user_id = ?)),
           updatedAt = datetime('now')
       WHERE id = ?`
    )
    .bind(userId, userId)
    .run();
}

// Per-action counts from the ledger for one user, e.g. { first_report: 3, ... }.
async function actionCounts(
  db: D1Database,
  userId: string
): Promise<Record<string, number>> {
  const rows = await db
    .prepare(
      `SELECT action, COUNT(*) AS n FROM karma_event WHERE user_id = ? GROUP BY action`
    )
    .bind(userId)
    .all<{ action: string; n: number }>();
  const counts: Record<string, number> = {};
  for (const r of rows.results ?? []) counts[r.action] = r.n;
  return counts;
}

function trackProgress(track: MilestoneTrack, counts: Record<string, number>) {
  const count = track.counts.reduce((sum, a) => sum + (counts[a] ?? 0), 0);
  const unlocked = track.thresholds.filter((t) => count >= t).length;
  const next =
    unlocked < track.thresholds.length ? track.thresholds[unlocked] : null;
  return { count, unlocked, next };
}

// After any count-changing award, top up milestone bonuses for newly-crossed
// levels. Idempotent: each (track, level) bonus has a unique dedup_key.
export async function checkAndAwardMilestones(
  db: D1Database,
  userId: string | null
): Promise<void> {
  if (!userId) return;
  const counts = await actionCounts(db, userId);

  const bonusAwards: AwardInput[] = [];
  for (const track of MILESTONES) {
    const { unlocked } = trackProgress(track, counts);
    for (let level = 0; level < unlocked; level++) {
      const bonus = track.bonuses[level] ?? 0;
      if (bonus <= 0) continue;
      bonusAwards.push({
        action: "milestone",
        points: bonus,
        dedupKey: `milestone:${track.id}:${level + 1}`,
        details: {
          track: track.id,
          level: level + 1,
          threshold: track.thresholds[level],
        },
      });
    }
  }
  if (bonusAwards.length > 0) await awardKarma(db, userId, bonusAwards);
}

export interface KarmaStats {
  total_points: number;
  counts: Record<string, number>;
  actions: { action: string; label: string; points: number; count: number }[];
  milestones: {
    id: MilestoneTrackId;
    label: string;
    description: string;
    count: number;
    unlocked: number;
    next: number | null;
    levels: { level: number; threshold: number; bonus: number; unlocked: boolean }[];
  }[];
}

// Everything the profile page needs in one shot: total, per-action stats, and
// both milestone tracks' progress.
export async function getKarmaStats(
  db: D1Database,
  userId: string
): Promise<KarmaStats> {
  const counts = await actionCounts(db, userId);
  const totalRow = await db
    .prepare(`SELECT COALESCE(SUM(points), 0) AS total FROM karma_event WHERE user_id = ?`)
    .bind(userId)
    .first<{ total: number }>();

  return {
    total_points: Math.max(0, totalRow?.total ?? 0),
    counts,
    actions: ACTION_META.map((m) => ({
      action: m.action,
      label: m.label,
      points: POINTS[m.action],
      count: counts[m.action] ?? 0,
    })),
    milestones: MILESTONES.map((track) => {
      const { count, unlocked, next } = trackProgress(track, counts);
      return {
        id: track.id,
        label: track.label,
        description: track.description,
        count,
        unlocked,
        next,
        levels: track.thresholds.map((threshold, i) => ({
          level: i + 1,
          threshold,
          bonus: track.bonuses[i] ?? 0,
          unlocked: count >= threshold,
        })),
      };
    }),
  };
}

// Award the fix-award fan-out for a doodie that just transitioned to a resolved
// state. The first reporter (reporter_id) gets first_report_fixed; every distinct
// re-reporter gets report_fixed. Dedup keys ensure each reporter is paid once per
// doodie regardless of how the fix was triggered (auditor PATCH or clean re-check).
export async function awardFixToReporters(
  db: D1Database,
  doodieId: string,
  reporterId: string | null
): Promise<void> {
  const affected: string[] = [];

  if (reporterId) {
    await awardKarma(db, reporterId, [
      {
        action: "first_report_fixed",
        points: POINTS.first_report_fixed,
        doodieId,
        dedupKey: `firstfixed:${doodieId}`,
        details: { doodie_id: doodieId },
      },
    ]);
    affected.push(reporterId);
  }

  const reReporters = await db
    .prepare(
      `SELECT DISTINCT user_id FROM doodie_re_report WHERE doodie_id = ? AND user_id IS NOT NULL`
    )
    .bind(doodieId)
    .all<{ user_id: string }>();

  for (const r of reReporters.results ?? []) {
    if (r.user_id === reporterId) continue; // first reporter already got the bigger award
    await awardKarma(db, r.user_id, [
      {
        action: "report_fixed",
        points: POINTS.report_fixed,
        doodieId,
        dedupKey: `fixed:${doodieId}`,
        details: { doodie_id: doodieId },
      },
    ]);
    affected.push(r.user_id);
  }

  for (const uid of affected) await checkAndAwardMilestones(db, uid);
}
