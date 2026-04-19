import type { FastifyInstance } from "fastify";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { openDb } from "../db/client.js";
import { rssFeed } from "../db/schema.js";
import { config } from "../config.js";
import { rebuildFeed } from "../publishing/rss.js";

export async function rssRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { slug: string } }>("/rss/:slug.xml", async (req, reply) => {
    const slug = req.params.slug;
    const db = openDb();
    const feed = db.select().from(rssFeed).where(eq(rssFeed.slug, slug)).get();
    if (!feed || !feed.active) return reply.code(404).send("not found");

    const path = join(config.MEDIA_ROOT, "rss", `${slug}.xml`);
    try {
      await stat(path);
    } catch {
      // Build lazily on first request if the file isn't there yet.
      await rebuildFeed(slug);
    }

    try {
      const s = await stat(path);
      reply
        .header("Content-Type", "application/rss+xml; charset=utf-8")
        .header("Content-Length", s.size)
        .header("Cache-Control", "public, max-age=60");
      return reply.send(createReadStream(path));
    } catch {
      return reply.code(500).send("feed unavailable");
    }
  });
}
