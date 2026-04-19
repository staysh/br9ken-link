import { eq, ne, and } from "drizzle-orm";
import { openDb, rawDb } from "../db/client.js";
import { flyer, moderator, moderationDispatch, flyerMedia } from "../db/schema.js";
import { audit } from "../util/audit.js";
import { quarantineMedia } from "../publishing/media.js";
import { rebuildFeedsForFlyer } from "../publishing/rss.js";
import { getProvider } from "../providers/index.js";

export type Decision = "approved" | "rejected";

export interface DecisionResult {
  flyerId: string;
  shortId: string;
  won: boolean;
  status: "approved" | "rejected" | "already_decided" | "not_found";
}

/**
 * Atomic state transition: the first moderator whose UPDATE affects a row wins.
 * Losing moderators get `won=false` and status=already_decided.
 */
export async function decide(args: { shortId: string; moderatorId: string; decision: Decision }): Promise<DecisionResult> {
  const raw = rawDb();
  const row = raw.prepare("SELECT * FROM flyer WHERE short_id = ?").get(args.shortId) as { id: string; status: string } | undefined;
  if (!row) return { flyerId: "", shortId: args.shortId, won: false, status: "not_found" };

  const now = Date.now();
  const stmt = raw.prepare(
    `UPDATE flyer
       SET status = ?, decided_at = ?, decided_by_moderator_id = ?
     WHERE id = ? AND status = 'pending'`
  );
  const info = stmt.run(args.decision, now, args.moderatorId, row.id);
  if (info.changes === 0) {
    return { flyerId: row.id, shortId: args.shortId, won: false, status: "already_decided" };
  }

  audit({
    actor: args.moderatorId,
    actorKind: "moderator",
    verb: `flyer.${args.decision}`,
    subjectKind: "flyer",
    subjectId: row.id,
  });

  if (args.decision === "rejected") {
    await quarantineMedia(row.id);
  }

  await rebuildFeedsForFlyer(row.id, args.decision);
  await notifyOtherModerators(row.id, args.moderatorId);

  return { flyerId: row.id, shortId: args.shortId, won: true, status: args.decision };
}

async function notifyOtherModerators(flyerId: string, decidedBy: string): Promise<void> {
  const db = openDb();
  const dispatches = db
    .select({ moderatorId: moderationDispatch.moderatorId })
    .from(moderationDispatch)
    .where(and(eq(moderationDispatch.flyerId, flyerId), ne(moderationDispatch.moderatorId, decidedBy)))
    .all();
  if (dispatches.length === 0) return;

  const provider = getProvider();
  const shortId = db.select({ shortId: flyer.shortId }).from(flyer).where(eq(flyer.id, flyerId)).get()?.shortId ?? "";

  for (const d of dispatches) {
    const m = db.select({ phone: moderator.phone }).from(moderator).where(eq(moderator.id, d.moderatorId)).get();
    if (!m?.phone) continue;
    try {
      await provider.sendText(m.phone, `Flyer ${shortId}: handled — thanks.`);
    } catch {
      // non-fatal
    }
  }
}

/**
 * Look up the moderator for an inbound phone number. Phone comparison is
 * expected to be in E.164 on both sides.
 */
export function findModeratorByPhone(phone: string): { id: string; isSuperAdmin: boolean } | null {
  const db = openDb();
  const m = db.select({ id: moderator.id, isSuperAdmin: moderator.isSuperAdmin }).from(moderator).where(eq(moderator.phone, phone)).get();
  return m ?? null;
}

// Re-exported helper for routes that want to display flyer media tied to a short id.
export function findFlyerByShortId(shortId: string): { id: string; status: string } | null {
  const db = openDb();
  const r = db.select({ id: flyer.id, status: flyer.status }).from(flyer).where(eq(flyer.shortId, shortId)).get();
  return r ?? null;
}

// Touch flyerMedia import so schema tree-shaking keeps the type reachable from here.
void flyerMedia;
