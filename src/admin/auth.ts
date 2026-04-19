import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { openDb } from "../db/client.js";
import { moderator, moderatorLoginToken } from "../db/schema.js";
import { config } from "../config.js";
import { audit } from "../util/audit.js";

const TOKEN_TTL_MS = 15 * 60 * 1000;

function genToken(): string {
  return randomBytes(24).toString("base64url");
}

export interface MintedLink {
  token: string;
  url: string;
  moderatorId: string;
  expiresAt: number;
}

export function mintLoginLinkByEmail(email: string): MintedLink | null {
  const db = openDb();
  const m = db.select().from(moderator).where(eq(moderator.email, email)).get();
  if (!m || !m.active) return null;
  return mintFor(m.id);
}

export function mintLoginLinkByPhone(phone: string): MintedLink | null {
  const db = openDb();
  const m = db.select().from(moderator).where(eq(moderator.phone, phone)).get();
  if (!m || !m.active) return null;
  return mintFor(m.id);
}

function mintFor(moderatorId: string): MintedLink {
  const db = openDb();
  const token = genToken();
  const now = Date.now();
  const expiresAt = now + TOKEN_TTL_MS;
  db.insert(moderatorLoginToken).values({
    token,
    moderatorId,
    expiresAt,
    createdAt: now,
  }).run();
  return {
    token,
    url: `${config.PUBLIC_BASE_URL.replace(/\/$/, "")}/admin/login/${token}`,
    moderatorId,
    expiresAt,
  };
}

/**
 * Consume a login token. Returns the moderator id on success or null if the
 * token is unknown, expired, or already used.
 */
export function consumeLoginToken(token: string): { moderatorId: string } | null {
  const db = openDb();
  const row = db.select().from(moderatorLoginToken).where(eq(moderatorLoginToken.token, token)).get();
  if (!row) return null;
  if (row.usedAt) return null;
  if (row.expiresAt < Date.now()) return null;
  db.update(moderatorLoginToken).set({ usedAt: Date.now() }).where(eq(moderatorLoginToken.token, token)).run();
  audit({ actorKind: "moderator", actor: row.moderatorId, verb: "admin.login", subjectKind: "moderator", subjectId: row.moderatorId });
  return { moderatorId: row.moderatorId };
}

export function getModeratorById(id: string): { id: string; name: string; email: string | null; isSuperAdmin: boolean } | null {
  const db = openDb();
  const m = db.select({
    id: moderator.id, name: moderator.name, email: moderator.email, isSuperAdmin: moderator.isSuperAdmin,
  }).from(moderator).where(eq(moderator.id, id)).get();
  return m ?? null;
}
