import { promises as fs } from "node:fs";
import { join } from "node:path";
import { and, eq, desc, gt, isNull, or } from "drizzle-orm";
import { create } from "xmlbuilder2";
import { openDb } from "../db/client.js";
import { flyer, flyerMedia, rssFeed } from "../db/schema.js";
import { config } from "../config.js";
import type { Decision } from "../moderation/decide.js";

export function feedDir(): string {
  return join(config.MEDIA_ROOT, "rss");
}

function feedPath(slug: string): string {
  return join(feedDir(), `${slug}.xml`);
}

function pub(path: string): string {
  return `${config.PUBLIC_BASE_URL.replace(/\/$/, "")}${path}`;
}

/**
 * Rebuild the XML for a single feed. Currently only the `global` scope is
 * honored; state/city/zip scopes are schema-ready but filtered as pass-through
 * in v1.
 */
export async function rebuildFeed(slug: string): Promise<{ count: number; path: string } | null> {
  const db = openDb();
  const feed = db.select().from(rssFeed).where(eq(rssFeed.slug, slug)).get();
  if (!feed || !feed.active) return null;

  const expiryCutoff = Date.now() - 24 * 60 * 60 * 1000;
  const rows = db
    .select()
    .from(flyer)
    .where(and(
      eq(flyer.status, "approved"),
      or(isNull(flyer.eventEnd), gt(flyer.eventEnd, expiryCutoff)),
    ))
    .orderBy(desc(flyer.decidedAt))
    .limit(200)
    .all();

  // Scope filter (post-query; low volume, trivial).
  const scoped = rows.filter((r) => matchesScope(r, feed.scopeType, feed.scopeValue));

  const doc = create({ version: "1.0", encoding: "UTF-8" })
    .ele("rss", { version: "2.0" })
      .ele("channel")
        .ele("title").txt(feed.title).up()
        .ele("link").txt(pub("/")).up()
        .ele("description").txt(feed.title).up()
        .ele("lastBuildDate").txt(new Date().toUTCString()).up();
  const channel = doc;

  for (const r of scoped) {
    const primary = db.select().from(flyerMedia).where(and(eq(flyerMedia.flyerId, r.id), eq(flyerMedia.isPrimary, true))).get();
    const item = channel.ele("item");
    item.ele("title").txt(r.title ?? "Flyer").up();
    item.ele("link").txt(pub(`/flyer/${r.publicId}`)).up();
    item.ele("guid", { isPermaLink: "true" }).txt(pub(`/flyer/${r.publicId}`)).up();
    item.ele("pubDate").txt(new Date(r.decidedAt ?? r.createdAt).toUTCString()).up();
    if (r.description) item.ele("description").txt(r.description).up();
    if (primary) {
      item.ele("enclosure", {
        url: pub(`/m/${primary.publicUuid}/${encodeURIComponent(primary.filename)}`),
        length: String(primary.bytes),
        type: primary.mime,
      }).up();
    }
  }

  const xml = doc.end({ prettyPrint: true });
  await fs.mkdir(feedDir(), { recursive: true });
  const path = feedPath(slug);
  await fs.writeFile(path, xml);

  db.update(rssFeed).set({ lastBuiltAt: Date.now() }).where(eq(rssFeed.id, feed.id)).run();
  return { count: scoped.length, path };
}

function matchesScope(row: { state: string | null; city: string | null; zip: string | null }, type: string, value: string | null): boolean {
  switch (type) {
    case "global": return true;
    case "state": return !!value && row.state === value;
    case "city":  return !!value && row.city?.toLowerCase() === value.toLowerCase();
    case "zip":   return !!value && row.zip === value;
    default: return false;
  }
}

export async function rebuildAllFeeds(): Promise<{ slug: string; count: number }[]> {
  const db = openDb();
  const feeds = db.select().from(rssFeed).where(eq(rssFeed.active, true)).all();
  const out: { slug: string; count: number }[] = [];
  for (const f of feeds) {
    const r = await rebuildFeed(f.slug);
    if (r) out.push({ slug: f.slug, count: r.count });
  }
  return out;
}

/**
 * On approve/reject, rebuild every feed whose scope could contain this flyer.
 * In v1 (global only) this is equivalent to rebuildAllFeeds; left separate so
 * we can scope it later without touching callers.
 */
export async function rebuildFeedsForFlyer(_flyerId: string, _decision: Decision): Promise<void> {
  await rebuildAllFeeds();
}
