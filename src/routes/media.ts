import type { FastifyInstance } from "fastify";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { openDb } from "../db/client.js";
import { flyer, flyerMedia } from "../db/schema.js";
import { publicPath } from "../publishing/media.js";

export async function mediaRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { uuid: string; file: string } }>("/m/:uuid/:file", async (req, reply) => {
    const { uuid, file } = req.params;
    const db = openDb();
    const media = db.select().from(flyerMedia).where(eq(flyerMedia.publicUuid, uuid)).get();
    if (!media || media.quarantined) return reply.code(404).send("not found");
    if (media.filename !== file) return reply.code(404).send("not found");

    const f = db.select({ status: flyer.status }).from(flyer).where(eq(flyer.id, media.flyerId)).get();
    if (!f) return reply.code(404).send("not found");
    // Media is visible for approved flyers on the public site; pending media is
    // accessible so moderators can open it from MMS links; rejected is hidden.
    if (f.status === "rejected") return reply.code(404).send("not found");

    const path = publicPath(media.storageKey);
    try {
      const s = await stat(path);
      reply
        .header("Content-Type", media.mime)
        .header("Content-Length", s.size)
        .header("Cache-Control", f.status === "approved" ? "public, max-age=300" : "private, no-store");
      return reply.send(createReadStream(path));
    } catch {
      return reply.code(404).send("not found");
    }
  });
}
