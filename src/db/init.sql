-- Initial schema. Idempotent to the extent of CREATE TABLE IF NOT EXISTS.
-- The spatial bits (geometry columns, spatial indexes) are handled in TS after
-- this file runs, because SpatiaLite's AddGeometryColumn errors on re-adds.

CREATE TABLE IF NOT EXISTS flyer (
  id TEXT PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  short_id TEXT NOT NULL,
  submitter_phone TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  title TEXT,
  description TEXT,
  event_start INTEGER,
  event_end INTEGER,
  venue TEXT,
  city TEXT,
  state TEXT,
  zip TEXT,
  lat REAL,
  lon REAL,
  created_at INTEGER NOT NULL,
  decided_at INTEGER,
  decided_by_moderator_id TEXT,
  parse_errors TEXT
);
-- Globally unique so rejected/approved flyers cannot have their codes reused by new
-- pending flyers; prevents stale moderator replies from latching onto a new flyer.
CREATE UNIQUE INDEX IF NOT EXISTS flyer_short_id_unique ON flyer(short_id);
CREATE INDEX IF NOT EXISTS flyer_status_idx ON flyer(status);
CREATE INDEX IF NOT EXISTS flyer_event_start_idx ON flyer(event_start);

CREATE TABLE IF NOT EXISTS flyer_media (
  id TEXT PRIMARY KEY,
  flyer_id TEXT NOT NULL REFERENCES flyer(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('image','video')),
  mime TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  storage_key TEXT NOT NULL,
  public_uuid TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  duration_s INTEGER,
  is_primary INTEGER NOT NULL DEFAULT 0,
  quarantined INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS flyer_media_flyer_idx ON flyer_media(flyer_id);

CREATE TABLE IF NOT EXISTS moderator (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  email TEXT,
  lat REAL,
  lon REAL,
  city TEXT,
  state TEXT,
  zip TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  is_super_admin INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS moderator_login_token (
  token TEXT PRIMARY KEY,
  moderator_id TEXT NOT NULL REFERENCES moderator(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS moderation_dispatch (
  id TEXT PRIMARY KEY,
  flyer_id TEXT NOT NULL REFERENCES flyer(id) ON DELETE CASCADE,
  moderator_id TEXT NOT NULL REFERENCES moderator(id) ON DELETE CASCADE,
  sent_at INTEGER NOT NULL,
  outbound_sid TEXT
);
CREATE INDEX IF NOT EXISTS moderation_dispatch_flyer_idx ON moderation_dispatch(flyer_id);

CREATE TABLE IF NOT EXISTS inbound_message (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  provider_sid TEXT NOT NULL UNIQUE,
  from_phone TEXT NOT NULL,
  to_phone TEXT NOT NULL,
  body TEXT,
  received_at INTEGER NOT NULL,
  processed_at INTEGER
);

CREATE TABLE IF NOT EXISTS outbound_message (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  provider_sid TEXT,
  to_phone TEXT NOT NULL,
  body TEXT NOT NULL,
  kind TEXT NOT NULL,
  flyer_id TEXT,
  sent_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS rss_feed (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('global','state','city','zip')),
  scope_value TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  last_built_at INTEGER
);

CREATE TABLE IF NOT EXISTS geocode_cache (
  key TEXT PRIMARY KEY,
  lat REAL,
  lon REAL,
  miss INTEGER NOT NULL DEFAULT 0,
  source TEXT,
  resolved_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_event (
  id TEXT PRIMARY KEY,
  actor TEXT,
  actor_kind TEXT NOT NULL,
  verb TEXT NOT NULL,
  subject_kind TEXT NOT NULL,
  subject_id TEXT,
  at INTEGER NOT NULL,
  meta TEXT
);

CREATE TABLE IF NOT EXISTS submitter_reply_outbox (
  id TEXT PRIMARY KEY,
  flyer_id TEXT NOT NULL,
  phone TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  sent_at INTEGER
);

-- Seed the single global RSS feed (idempotent).
INSERT OR IGNORE INTO rss_feed (id, slug, title, scope_type, scope_value, active)
VALUES ('feed_global', 'global', 'All Flyers', 'global', NULL, 1);
