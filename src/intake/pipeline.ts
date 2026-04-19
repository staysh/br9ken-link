import { randomUUID } from "node:crypto";
import { ulid } from "ulid";
import { parsePhoneNumberFromString } from "libphonenumber-js";
import { and, eq, gte } from "drizzle-orm";
import { openDb } from "../db/client.js";
import { flyer, flyerMedia, inboundMessage, submitterReplyOutbox } from "../db/schema.js";
import { syncGeom } from "../db/migrate.js";
import { config } from "../config.js";
import { getProvider } from "../providers/index.js";
import type { InboundMessage } from "../providers/base.js";
import { kindFromMime } from "../providers/mime.js";
import { generateUniquePending } from "./shortId.js";
import { parseBody } from "./parse.js";
import { geocode } from "./geocode.js";
import { writePublicMedia } from "../publishing/media.js";
import { dispatchFlyer } from "../moderation/dispatch.js";
import { audit } from "../util/audit.js";

export function normalizePhone(raw: string): string {
  const p = parsePhoneNumberFromString(raw, "US");
  return p?.isValid() ? p.number : raw;
}

/** Returns true if the submission should be rate-limited (over the hour/day cap). */
export function overSubmitRate(phone: string): boolean {
  const db = openDb();
  const now = Date.now();
  const hourAgo = now - 60 * 60 * 1000;
  const dayAgo  = now - 24 * 60 * 60 * 1000;
  const hourCount = db.select({ id: flyer.id }).from(flyer)
    .where(and(eq(flyer.submitterPhone, phone), gte(flyer.createdAt, hourAgo))).all().length;
  if (hourCount >= config.SUBMIT_RATE_HOUR) return true;
  const dayCount = db.select({ id: flyer.id }).from(flyer)
    .where(and(eq(flyer.submitterPhone, phone), gte(flyer.createdAt, dayAgo))).all().length;
  return dayCount >= config.SUBMIT_RATE_DAY;
}

export interface IngestResult {
  flyerId?: string;
  shortId?: string;
  skipped?: "duplicate" | "rate_limited" | "no_media";
  parseErrors: string[];
  dispatched?: { dispatched: number; skipped: string[] };
}

/**
 * End-to-end intake: dedupe → create flyer → download media → parse + geocode →
 * dispatch to moderators. The inbound_message idempotency write happens up in
 * the route so the webhook can 200 before we do network work.
 */
export async function ingestSubmission(msg: InboundMessage): Promise<IngestResult> {
  const phone = normalizePhone(msg.from);

  if (overSubmitRate(phone)) {
    audit({ actorKind: "submitter", actor: phone, verb: "submission.rate_limited", subjectKind: "phone", subjectId: phone });
    return { skipped: "rate_limited", parseErrors: [] };
  }
  if (msg.media.length === 0) {
    audit({ actorKind: "submitter", actor: phone, verb: "submission.no_media", subjectKind: "phone", subjectId: phone });
    return { skipped: "no_media", parseErrors: ["no media attached"] };
  }

  const parsed = parseBody(msg.body);
  const shortId = await generateUniquePending();
  const flyerId = ulid();
  const publicId = randomUUID();
  const now = Date.now();

  const db = openDb();
  db.insert(flyer).values({
    id: flyerId,
    publicId,
    shortId,
    submitterPhone: phone,
    status: "pending",
    title: parsed.title ?? null,
    description: parsed.description ?? null,
    eventStart: parsed.eventStart ?? null,
    eventEnd: parsed.eventEnd ?? null,
    venue: parsed.venue ?? null,
    city: parsed.city ?? null,
    state: parsed.state ?? null,
    zip: parsed.zip ?? null,
    lat: null,
    lon: null,
    createdAt: now,
    parseErrors: parsed.parseErrors.length ? parsed.parseErrors.join("; ") : null,
  }).run();

  const geo = await geocode({ city: parsed.city, state: parsed.state, zip: parsed.zip });
  if (geo) {
    db.update(flyer).set({ lat: geo.lat, lon: geo.lon }).where(eq(flyer.id, flyerId)).run();
    try { syncGeom("flyer", flyerId, geo.lat, geo.lon); } catch { /* spatialite absent */ }
  } else if (parsed.city || parsed.zip) {
    appendParseError(flyerId, "geocode failed");
  }

  const provider = getProvider();
  let primaryAssigned = false;
  for (const m of msg.media) {
    const kind = kindFromMime(m.mime);
    if (!kind) continue;
    try {
      const fetched = await provider.fetchMedia(m);
      const cap = kind === "video" ? config.MEDIA_MAX_VIDEO_BYTES : config.MEDIA_MAX_IMAGE_BYTES;
      if (fetched.buf.length > cap) {
        appendParseError(flyerId, `media too large (${kind}): ${fetched.buf.length}B > ${cap}B`);
        continue;
      }
      const publicUuid = randomUUID();
      const storageKey = `${publicUuid}/${fetched.filename}`;
      await writePublicMedia(storageKey, fetched.buf);
      db.insert(flyerMedia).values({
        id: ulid(),
        flyerId,
        kind,
        mime: fetched.mime,
        bytes: fetched.buf.length,
        storageKey,
        publicUuid,
        filename: fetched.filename,
        isPrimary: !primaryAssigned,
        quarantined: false,
      }).run();
      primaryAssigned = true;
    } catch (e) {
      appendParseError(flyerId, `media fetch failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Stub submitter auto-reply (not sent in v1).
  db.insert(submitterReplyOutbox).values({
    id: ulid(), flyerId, phone, body: `Received. Ref ${shortId}.`, createdAt: now,
  }).run();

  audit({ actorKind: "submitter", actor: phone, verb: "flyer.received", subjectKind: "flyer", subjectId: flyerId, meta: { shortId, parseErrors: parsed.parseErrors } });

  // Dispatch only if we have at least one usable media and a parsed location.
  let dispatched;
  if (primaryAssigned && (geo || !parsed.city) /* still dispatch if no location? skip if we can't rank */) {
    dispatched = await dispatchFlyer(flyerId);
  }

  return { flyerId, shortId, parseErrors: parsed.parseErrors, ...(dispatched ? { dispatched } : {}) };
}

function appendParseError(flyerId: string, err: string): void {
  const db = openDb();
  const row = db.select({ pe: flyer.parseErrors }).from(flyer).where(eq(flyer.id, flyerId)).get();
  const joined = [row?.pe, err].filter(Boolean).join("; ");
  db.update(flyer).set({ parseErrors: joined }).where(eq(flyer.id, flyerId)).run();
}

/** Write the idempotency row. Returns false if provider_sid was already processed. */
export function recordInbound(msg: { providerSid: string; provider: string; from: string; to: string; body: string }): boolean {
  const db = openDb();
  const now = Date.now();
  try {
    db.insert(inboundMessage).values({
      id: ulid(),
      provider: msg.provider,
      providerSid: msg.providerSid,
      fromPhone: msg.from,
      toPhone: msg.to,
      body: msg.body,
      receivedAt: now,
    }).run();
    return true;
  } catch {
    return false;
  }
}
