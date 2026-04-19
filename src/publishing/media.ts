import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";
import { eq } from "drizzle-orm";
import { openDb } from "../db/client.js";
import { flyerMedia } from "../db/schema.js";
import { config } from "../config.js";
import { audit } from "../util/audit.js";

export function publicPath(storageKey: string): string {
  return join(config.MEDIA_ROOT, "public", storageKey);
}
export function quarantinePath(storageKey: string): string {
  return join(config.MEDIA_ROOT, "quarantine", storageKey);
}

/**
 * Move every media file belonging to a flyer from the public tree into the
 * quarantine tree and flip the `quarantined` flag. The DB row is preserved so
 * rejected flyers remain fully traceable.
 */
export async function quarantineMedia(flyerId: string): Promise<{ moved: number; failed: string[] }> {
  const db = openDb();
  const rows = db.select().from(flyerMedia).where(eq(flyerMedia.flyerId, flyerId)).all();
  const failed: string[] = [];
  let moved = 0;
  for (const m of rows) {
    if (m.quarantined) continue;
    const src = publicPath(m.storageKey);
    const dst = quarantinePath(m.storageKey);
    try {
      await fs.mkdir(dirname(dst), { recursive: true });
      await fs.rename(src, dst);
      db.update(flyerMedia).set({ quarantined: true }).where(eq(flyerMedia.id, m.id)).run();
      moved++;
    } catch (e) {
      // If the file is already missing (e.g. already quarantined), still mark the row.
      if ((e as NodeJS.ErrnoException)?.code === "ENOENT") {
        db.update(flyerMedia).set({ quarantined: true }).where(eq(flyerMedia.id, m.id)).run();
        continue;
      }
      failed.push(`${m.storageKey}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  audit({ actorKind: "system", verb: "media.quarantined", subjectKind: "flyer", subjectId: flyerId, meta: { moved, failed } });
  return { moved, failed };
}

export async function ensureMediaDirs(): Promise<void> {
  await fs.mkdir(join(config.MEDIA_ROOT, "public"), { recursive: true });
  await fs.mkdir(join(config.MEDIA_ROOT, "quarantine"), { recursive: true });
  await fs.mkdir(join(config.MEDIA_ROOT, "rss"), { recursive: true });
}

/**
 * Write a single media blob into the public tree.
 * storageKey is `<publicUuid>/<filename>` — the same path is exposed under /m/.
 */
export async function writePublicMedia(storageKey: string, buf: Buffer): Promise<string> {
  const dst = publicPath(storageKey);
  await fs.mkdir(dirname(dst), { recursive: true });
  await fs.writeFile(dst, buf);
  return dst;
}
