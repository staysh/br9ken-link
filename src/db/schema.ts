import { sqliteTable, text, integer, real, index } from "drizzle-orm/sqlite-core";

// Timestamps are unix epoch milliseconds (integer). Kept numeric for portability and
// cheap ORDER BY / range queries.

export const flyer = sqliteTable("flyer", {
  id: text("id").primaryKey(),
  publicId: text("public_id").notNull().unique(),
  shortId: text("short_id").notNull().unique(),
  submitterPhone: text("submitter_phone").notNull(),
  status: text("status", { enum: ["pending", "approved", "rejected"] }).notNull().default("pending"),
  title: text("title"),
  description: text("description"),
  eventStart: integer("event_start"),
  eventEnd: integer("event_end"),
  venue: text("venue"),
  city: text("city"),
  state: text("state"),
  zip: text("zip"),
  lat: real("lat"),
  lon: real("lon"),
  createdAt: integer("created_at").notNull(),
  decidedAt: integer("decided_at"),
  decidedByModeratorId: text("decided_by_moderator_id"),
  parseErrors: text("parse_errors"),
}, (t) => ({
  statusIdx: index("flyer_status_idx").on(t.status),
  eventStartIdx: index("flyer_event_start_idx").on(t.eventStart),
}));

export const flyerMedia = sqliteTable("flyer_media", {
  id: text("id").primaryKey(),
  flyerId: text("flyer_id").notNull().references(() => flyer.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: ["image", "video"] }).notNull(),
  mime: text("mime").notNull(),
  bytes: integer("bytes").notNull(),
  storageKey: text("storage_key").notNull(),
  publicUuid: text("public_uuid").notNull().unique(),
  filename: text("filename").notNull(),
  width: integer("width"),
  height: integer("height"),
  durationS: integer("duration_s"),
  isPrimary: integer("is_primary", { mode: "boolean" }).notNull().default(false),
  quarantined: integer("quarantined", { mode: "boolean" }).notNull().default(false),
}, (t) => ({
  flyerIdx: index("flyer_media_flyer_idx").on(t.flyerId),
}));

export const moderator = sqliteTable("moderator", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  phone: text("phone").notNull().unique(),
  email: text("email"),
  lat: real("lat"),
  lon: real("lon"),
  city: text("city"),
  state: text("state"),
  zip: text("zip"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  isSuperAdmin: integer("is_super_admin", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at").notNull(),
});

export const moderatorLoginToken = sqliteTable("moderator_login_token", {
  token: text("token").primaryKey(),
  moderatorId: text("moderator_id").notNull().references(() => moderator.id, { onDelete: "cascade" }),
  expiresAt: integer("expires_at").notNull(),
  usedAt: integer("used_at"),
  createdAt: integer("created_at").notNull(),
});

export const moderationDispatch = sqliteTable("moderation_dispatch", {
  id: text("id").primaryKey(),
  flyerId: text("flyer_id").notNull().references(() => flyer.id, { onDelete: "cascade" }),
  moderatorId: text("moderator_id").notNull().references(() => moderator.id, { onDelete: "cascade" }),
  sentAt: integer("sent_at").notNull(),
  outboundSid: text("outbound_sid"),
}, (t) => ({
  flyerIdx: index("moderation_dispatch_flyer_idx").on(t.flyerId),
}));

export const inboundMessage = sqliteTable("inbound_message", {
  id: text("id").primaryKey(),
  provider: text("provider").notNull(),
  providerSid: text("provider_sid").notNull().unique(),
  fromPhone: text("from_phone").notNull(),
  toPhone: text("to_phone").notNull(),
  body: text("body"),
  receivedAt: integer("received_at").notNull(),
  processedAt: integer("processed_at"),
});

export const outboundMessage = sqliteTable("outbound_message", {
  id: text("id").primaryKey(),
  provider: text("provider").notNull(),
  providerSid: text("provider_sid"),
  toPhone: text("to_phone").notNull(),
  body: text("body").notNull(),
  kind: text("kind").notNull(),
  flyerId: text("flyer_id"),
  sentAt: integer("sent_at").notNull(),
});

export const rssFeed = sqliteTable("rss_feed", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  scopeType: text("scope_type", { enum: ["global", "state", "city", "zip"] }).notNull(),
  scopeValue: text("scope_value"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  lastBuiltAt: integer("last_built_at"),
});

export const geocodeCache = sqliteTable("geocode_cache", {
  key: text("key").primaryKey(),
  lat: real("lat"),
  lon: real("lon"),
  miss: integer("miss", { mode: "boolean" }).notNull().default(false),
  source: text("source"),
  resolvedAt: integer("resolved_at").notNull(),
});

export const auditEvent = sqliteTable("audit_event", {
  id: text("id").primaryKey(),
  actor: text("actor"),
  actorKind: text("actor_kind").notNull(),
  verb: text("verb").notNull(),
  subjectKind: text("subject_kind").notNull(),
  subjectId: text("subject_id"),
  at: integer("at").notNull(),
  meta: text("meta"),
});

export const submitterReplyOutbox = sqliteTable("submitter_reply_outbox", {
  id: text("id").primaryKey(),
  flyerId: text("flyer_id").notNull(),
  phone: text("phone").notNull(),
  body: text("body").notNull(),
  createdAt: integer("created_at").notNull(),
  sentAt: integer("sent_at"),
});


