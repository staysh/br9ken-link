import { ulid } from "ulid";
import { and, eq } from "drizzle-orm";
import { openDb, rawDb } from "../db/client.js";
import { flyer, flyerMedia, moderationDispatch, outboundMessage } from "../db/schema.js";
import { config } from "../config.js";
import { getProvider } from "../providers/index.js";
import { audit } from "../util/audit.js";

interface NearbyModerator {
  id: string;
  phone: string;
  name: string;
  distance_m: number | null;
}

/**
 * Find the N nearest active moderators to the flyer's lat/lon. If the flyer has
 * no geolocation or SpatiaLite is unavailable, fall back to any active
 * moderators (ordered by created_at).
 */
export function findNearestModerators(flyerLat: number | null, flyerLon: number | null, n = config.MODERATOR_FANOUT): NearbyModerator[] {
  const db = rawDb();
  if (flyerLat == null || flyerLon == null) {
    return db
      .prepare(
        `SELECT id, phone, name, NULL AS distance_m
         FROM moderator
         WHERE active = 1
         ORDER BY created_at ASC
         LIMIT ?`
      )
      .all(n) as NearbyModerator[];
  }
  return db
    .prepare(
      `SELECT id, phone, name,
              Distance(geom, MakePoint(?, ?, 4326), 1) AS distance_m
       FROM moderator
       WHERE active = 1 AND geom IS NOT NULL
       ORDER BY distance_m ASC
       LIMIT ?`
    )
    .all(flyerLon, flyerLat, n) as NearbyModerator[];
}

export async function dispatchFlyer(flyerId: string): Promise<{ dispatched: number; skipped: string[] }> {
  const db = openDb();
  const row = db.select().from(flyer).where(eq(flyer.id, flyerId)).get();
  if (!row) throw new Error(`flyer ${flyerId} not found`);
  if (row.status !== "pending") return { dispatched: 0, skipped: [`flyer not pending (status=${row.status})`] };

  const primary = db
    .select()
    .from(flyerMedia)
    .where(and(eq(flyerMedia.flyerId, flyerId), eq(flyerMedia.isPrimary, true)))
    .get();

  const mediaUrls = primary ? [`${config.PUBLIC_BASE_URL}/m/${primary.publicUuid}/${encodeURIComponent(primary.filename)}`] : [];
  const body = `Flyer ${row.shortId}: "${row.title ?? "(untitled)"}" — reply "${row.shortId} YES" to approve or "${row.shortId} NO" to reject.`;

  const targets = findNearestModerators(row.lat, row.lon);
  if (targets.length === 0) {
    audit({ actorKind: "system", verb: "dispatch.no_moderators", subjectKind: "flyer", subjectId: flyerId });
    return { dispatched: 0, skipped: ["no active moderators"] };
  }

  const provider = getProvider();
  const skipped: string[] = [];
  let dispatched = 0;

  for (const m of targets) {
    try {
      const out = mediaUrls.length
        ? await provider.sendMedia(m.phone, body, mediaUrls)
        : await provider.sendText(m.phone, body);
      db.insert(moderationDispatch).values({
        id: ulid(),
        flyerId,
        moderatorId: m.id,
        sentAt: Date.now(),
        outboundSid: out.providerSid,
      }).run();
      db.insert(outboundMessage).values({
        id: ulid(),
        provider: provider.name,
        providerSid: out.providerSid,
        toPhone: m.phone,
        body,
        kind: "moderation_dispatch",
        flyerId,
        sentAt: Date.now(),
      }).run();
      dispatched++;
    } catch (e) {
      skipped.push(`${m.phone}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  audit({
    actorKind: "system",
    verb: "dispatch.sent",
    subjectKind: "flyer",
    subjectId: flyerId,
    meta: { dispatched, skipped, moderatorIds: targets.map((t) => t.id) },
  });

  return { dispatched, skipped };
}
