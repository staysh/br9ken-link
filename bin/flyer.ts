#!/usr/bin/env node
import { Command } from "commander";
import { ulid } from "ulid";
import { parsePhoneNumberFromString } from "libphonenumber-js";
import { openDb, rawDb } from "../src/db/client.js";
import { runInit, syncGeom } from "../src/db/migrate.js";
import { moderator } from "../src/db/schema.js";
import { eq } from "drizzle-orm";
import { config } from "../src/config.js";
import { geocode } from "../src/intake/geocode.js";
import { mintLoginLinkByEmail, mintLoginLinkByPhone } from "../src/admin/auth.js";
import { rebuildAllFeeds, rebuildFeed } from "../src/publishing/rss.js";
import { ensureMediaDirs } from "../src/publishing/media.js";
import { getProvider } from "../src/providers/index.js";

const program = new Command();
program.name("flyer").description("Flyer aggregator operations").version("0.1.0");

program
  .command("init")
  .description("Initialize database and media directories")
  .action(async () => {
    await ensureMediaDirs();
    const res = runInit();
    console.log(`schema applied; spatialite=${res.spatialite}; added geom for: ${res.addedGeom.join(", ") || "(none)"}`);
  });

const sa = program.command("super-admin").description("Super admin management");
sa.command("add")
  .argument("<phone>", "+E.164 phone number")
  .argument("<zip>", "US ZIP for locality")
  .argument("<email>", "email for admin sign-in links")
  .argument("<name...>", "display name")
  .action(async (phone: string, zip: string, email: string, nameParts: string[]) => {
    const parsed = parsePhoneNumberFromString(phone, "US");
    if (!parsed?.isValid()) { console.error("Invalid phone"); process.exit(2); }
    const name = nameParts.join(" ").trim();
    if (!name) { console.error("Missing name"); process.exit(2); }

    await ensureMediaDirs();
    runInit();
    const db = openDb();
    const existing = db.select().from(moderator).where(eq(moderator.phone, parsed.number)).get();
    if (existing) {
      db.update(moderator).set({ isSuperAdmin: true, active: true, email, name, zip }).where(eq(moderator.id, existing.id)).run();
      console.log(`Updated existing moderator ${existing.id} to super admin.`);
    } else {
      const id = ulid();
      db.insert(moderator).values({
        id, name, phone: parsed.number, email, zip,
        active: true, isSuperAdmin: true, createdAt: Date.now(),
      }).run();
      console.log(`Created super admin ${id} (${name}).`);
      const g = await geocode({ zip });
      if (g) {
        db.update(moderator).set({ lat: g.lat, lon: g.lon }).where(eq(moderator.id, id)).run();
        try { syncGeom("moderator", id, g.lat, g.lon); } catch { /* spatialite absent */ }
        console.log(`Geocoded ${zip} -> ${g.lat.toFixed(4)}, ${g.lon.toFixed(4)}`);
      } else {
        console.warn(`Could not geocode ZIP ${zip}; moderator will not be ranked by distance until updated.`);
      }
    }
  });

const admin = program.command("admin").description("Admin utilities");
admin.command("login-link")
  .argument("<who>", "+E.164 phone or email")
  .action((who: string) => {
    const link = who.includes("@") ? mintLoginLinkByEmail(who.toLowerCase()) : mintLoginLinkByPhone(parsePhoneNumberFromString(who, "US")?.number ?? who);
    if (!link) { console.error("No active moderator matched."); process.exit(3); }
    console.log(link.url);
  });

const rss = program.command("rss").description("RSS feed operations");
rss.command("rebuild")
  .option("--slug <slug>", "single feed slug")
  .action(async (opts: { slug?: string }) => {
    runInit();
    if (opts.slug) {
      const r = await rebuildFeed(opts.slug);
      console.log(r ? `${opts.slug}: ${r.count} items -> ${r.path}` : `${opts.slug}: not found or inactive`);
    } else {
      const all = await rebuildAllFeeds();
      for (const f of all) console.log(`${f.slug}: ${f.count} items`);
    }
  });

program
  .command("doctor")
  .description("Run diagnostics on DB, media, SpatiaLite, and provider config")
  .action(async () => {
    const issues: string[] = [];

    await ensureMediaDirs();
    const init = runInit();
    if (!init.spatialite) issues.push(`SpatiaLite not loaded (SPATIALITE_PATH=${config.SPATIALITE_PATH})`);

    const raw = rawDb();
    try { raw.prepare("SELECT Distance(MakePoint(0,0,4326), MakePoint(0,1,4326))").get(); }
    catch (e) { issues.push(`SpatiaLite Distance() failed: ${e instanceof Error ? e.message : String(e)}`); }

    try { getProvider().name; } catch (e) { issues.push(`Provider: ${e instanceof Error ? e.message : String(e)}`); }

    if (!config.TWILIO_ACCOUNT_SID || !config.TWILIO_AUTH_TOKEN || !config.TWILIO_FROM_NUMBER) {
      issues.push("Twilio credentials are incomplete.");
    }
    if (!config.SMTP_HOST) issues.push("SMTP not configured; magic-link email will be printed to logs.");

    console.log(`DATABASE_URL=${config.DATABASE_URL}`);
    console.log(`MEDIA_ROOT=${config.MEDIA_ROOT}`);
    console.log(`spatialite=${init.spatialite ? "ok" : "missing"}`);
    if (issues.length === 0) console.log("all checks passed");
    else { for (const i of issues) console.warn(`- ${i}`); process.exitCode = 1; }
  });

// Stubs for post-v1 SMS-mirrored CLI verbs.
for (const verb of ["mod", "feed", "flyer", "quarantine"]) {
  program.command(verb).description(`${verb} operations (not implemented in v1)`).action(() => {
    console.error(`"${verb}" is not implemented in v1.`);
    process.exit(64);
  });
}

program.parseAsync().catch((e) => {
  console.error(e instanceof Error ? e.stack ?? e.message : String(e));
  process.exit(1);
});
