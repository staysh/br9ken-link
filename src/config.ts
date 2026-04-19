import { z } from "zod";
import { readFileSync, existsSync } from "node:fs";

// Minimal .env loader: loads KEY=VALUE lines from .env if present. Avoids a dotenv
// dependency and keeps precedence on whatever is already in process.env.
function loadDotenv(path = ".env"): void {
  if (!existsSync(path)) return;
  const txt = readFileSync(path, "utf8");
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!(k in process.env)) process.env[k] = v;
  }
}

loadDotenv();

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().positive().default(3000),
  PUBLIC_BASE_URL: z.string().url(),
  SITE_NAME: z.string().default("dinky.horse"),
  CONTACT_EMAIL: z.string().email().default("staysh@br9ken.link"),

  DATABASE_URL: z.string().default("./data/flyer.sqlite"),
  SPATIALITE_PATH: z.string().default("mod_spatialite"),
  MEDIA_ROOT: z.string().default("./media"),

  MESSAGING_PROVIDER: z.enum(["twilio"]).default("twilio"),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_FROM_NUMBER: z.string().optional(),

  MODERATOR_FANOUT: z.coerce.number().int().positive().default(3),

  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().optional(),

  SESSION_SECRET: z.string().min(32),

  SUBMIT_RATE_HOUR: z.coerce.number().int().positive().default(5),
  SUBMIT_RATE_DAY: z.coerce.number().int().positive().default(20),
  MEDIA_MAX_IMAGE_BYTES: z.coerce.number().int().positive().default(20 * 1024 * 1024),
  MEDIA_MAX_VIDEO_BYTES: z.coerce.number().int().positive().default(50 * 1024 * 1024),
  MEDIA_MAX_VIDEO_SECONDS: z.coerce.number().int().positive().default(60),

  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment:\n" + parsed.error.issues.map(i => `  ${i.path.join(".")}: ${i.message}`).join("\n"));
  process.exit(1);
}

export const config = parsed.data;
export type Config = typeof config;
