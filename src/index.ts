import Fastify from "fastify";
import formbody from "@fastify/formbody";
import staticPlugin from "@fastify/static";
import secureSession from "@fastify/secure-session";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createHash } from "node:crypto";
import { config } from "./config.js";
import { runInit } from "./db/migrate.js";
import { ensureMediaDirs } from "./publishing/media.js";
import { hooksRoutes } from "./routes/hooks.js";
import { mediaRoutes } from "./routes/media.js";
import { rssRoutes } from "./routes/rss.js";
import { publicRoutes } from "./routes/public.js";
import { adminRoutes } from "./routes/admin.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = resolve(HERE, "public");

// Derive a stable 32-byte key + 16-byte salt from SESSION_SECRET. This lets the
// operator rotate the session key by changing one env variable.
function deriveSessionKey(secret: string): { key: Buffer } {
  const key = createHash("sha256").update(`session-key::${secret}`).digest();
  return { key };
}

async function main(): Promise<void> {
  const app = Fastify({
    logger: { level: config.LOG_LEVEL, transport: config.NODE_ENV === "development" ? { target: "pino-pretty" } : undefined },
    trustProxy: true,
    bodyLimit: 5 * 1024 * 1024,
  });

  await ensureMediaDirs();
  const init = runInit();
  if (!init.spatialite) app.log.warn({ path: config.SPATIALITE_PATH }, "SpatiaLite not loaded; spatial features disabled");

  await app.register(formbody);
  await app.register(staticPlugin, { root: PUBLIC_DIR, prefix: "/static/", decorateReply: false });

  const { key } = deriveSessionKey(config.SESSION_SECRET);
  await app.register(secureSession, {
    key,
    cookie: {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: config.NODE_ENV === "production",
      maxAge: 7 * 24 * 60 * 60,
    },
  });

  await app.register(hooksRoutes);
  await app.register(mediaRoutes);
  await app.register(rssRoutes);
  await app.register(adminRoutes);
  await app.register(publicRoutes);

  app.setNotFoundHandler(async (_req, reply) => {
    reply.code(404).type("text/plain").send("not found");
  });

  const address = await app.listen({ host: config.HOST, port: config.PORT });
  app.log.info({ address }, "flyer aggregator listening");
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
