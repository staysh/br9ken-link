import { rawDb } from "../db/client.js";

export interface FeedFilters {
  q?: string;
  city?: string;
  state?: string;
  zip?: string;
  includeExpired?: boolean;
  cursor?: number;  // decidedAt epoch ms, exclusive
  limit?: number;
}

export interface FeedItem {
  publicId: string;
  title: string | null;
  description: string | null;
  eventStart: number | null;
  eventEnd: number | null;
  venue: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  decidedAt: number | null;
  primaryMediaUrl: string | null;
  primaryMediaMime: string | null;
}

/**
 * Fetch one page of approved, visible flyers with their primary media in one
 * round-trip. Cursor is `decidedAt` (DESC) exclusive.
 */
export function listApproved(filters: FeedFilters, baseUrl: string): { items: FeedItem[]; nextCursor: number | null } {
  const where: string[] = ["f.status = 'approved'"];
  const params: unknown[] = [];
  if (!filters.includeExpired) {
    where.push("(f.event_end IS NULL OR f.event_end > ?)");
    params.push(Date.now() - 24 * 60 * 60 * 1000);
  }
  if (filters.q) {
    where.push("(LOWER(f.title) LIKE ? OR LOWER(f.description) LIKE ?)");
    const like = `%${filters.q.toLowerCase()}%`;
    params.push(like, like);
  }
  if (filters.city) { where.push("LOWER(f.city) = ?"); params.push(filters.city.toLowerCase()); }
  if (filters.state) { where.push("f.state = ?"); params.push(filters.state.toUpperCase()); }
  if (filters.zip)   { where.push("f.zip = ?"); params.push(filters.zip); }
  if (filters.cursor) { where.push("f.decided_at < ?"); params.push(filters.cursor); }

  const limit = Math.max(1, Math.min(50, filters.limit ?? 20));
  const sql = `
    SELECT
      f.public_id       AS publicId,
      f.title           AS title,
      f.description     AS description,
      f.event_start     AS eventStart,
      f.event_end       AS eventEnd,
      f.venue           AS venue,
      f.city            AS city,
      f.state           AS state,
      f.zip             AS zip,
      f.decided_at      AS decidedAt,
      m.public_uuid     AS mediaUuid,
      m.filename        AS mediaFilename,
      m.mime            AS mediaMime
    FROM flyer f
    LEFT JOIN flyer_media m
      ON m.flyer_id = f.id AND m.is_primary = 1 AND m.quarantined = 0
    WHERE ${where.join(" AND ")}
    ORDER BY f.decided_at DESC
    LIMIT ?
  `;
  const rows = rawDb().prepare(sql).all(...params, limit) as Array<FeedItem & { mediaUuid: string | null; mediaFilename: string | null; mediaMime: string | null }>;

  const items: FeedItem[] = rows.map((r) => ({
    publicId: r.publicId,
    title: r.title,
    description: r.description,
    eventStart: r.eventStart,
    eventEnd: r.eventEnd,
    venue: r.venue,
    city: r.city,
    state: r.state,
    zip: r.zip,
    decidedAt: r.decidedAt,
    primaryMediaUrl: r.mediaUuid && r.mediaFilename
      ? `${baseUrl}/m/${r.mediaUuid}/${encodeURIComponent(r.mediaFilename)}`
      : null,
    primaryMediaMime: r.mediaMime,
  }));

  const nextCursor = items.length === limit ? items[items.length - 1]!.decidedAt : null;
  return { items, nextCursor };
}

export function getFlyerByPublicId(publicId: string, baseUrl: string): FeedItem | null {
  const sql = `
    SELECT
      f.public_id AS publicId, f.title, f.description,
      f.event_start AS eventStart, f.event_end AS eventEnd,
      f.venue, f.city, f.state, f.zip, f.decided_at AS decidedAt,
      m.public_uuid AS mediaUuid, m.filename AS mediaFilename, m.mime AS mediaMime
    FROM flyer f
    LEFT JOIN flyer_media m
      ON m.flyer_id = f.id AND m.is_primary = 1 AND m.quarantined = 0
    WHERE f.public_id = ? AND f.status = 'approved'
    LIMIT 1
  `;
  const r = rawDb().prepare(sql).get(publicId) as (FeedItem & { mediaUuid: string | null; mediaFilename: string | null; mediaMime: string | null }) | undefined;
  if (!r) return null;
  return {
    publicId: r.publicId,
    title: r.title,
    description: r.description,
    eventStart: r.eventStart,
    eventEnd: r.eventEnd,
    venue: r.venue,
    city: r.city,
    state: r.state,
    zip: r.zip,
    decidedAt: r.decidedAt,
    primaryMediaUrl: r.mediaUuid && r.mediaFilename
      ? `${baseUrl}/m/${r.mediaUuid}/${encodeURIComponent(r.mediaFilename)}`
      : null,
    primaryMediaMime: r.mediaMime,
  };
}
