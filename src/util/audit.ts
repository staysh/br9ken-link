import { ulid } from "ulid";
import { openDb } from "../db/client.js";
import { auditEvent } from "../db/schema.js";

export interface AuditInput {
  actor?: string | null;
  actorKind: string; // e.g. "system", "moderator", "super_admin", "submitter"
  verb: string;      // dotted verb, e.g. "flyer.approved"
  subjectKind: string;
  subjectId?: string | null;
  meta?: unknown;
}

export function audit(e: AuditInput): void {
  openDb().insert(auditEvent).values({
    id: ulid(),
    actor: e.actor ?? null,
    actorKind: e.actorKind,
    verb: e.verb,
    subjectKind: e.subjectKind,
    subjectId: e.subjectId ?? null,
    at: Date.now(),
    meta: e.meta === undefined ? null : JSON.stringify(e.meta),
  }).run();
}
