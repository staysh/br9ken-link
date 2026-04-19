import { decide, findModeratorByPhone } from "../decide.js";
import { helpCommand } from "./help.js";

/**
 * Parsed intent of an inbound message from a recognized moderator. The caller
 * (routes/hooks) decides what to do with an unrecognized body — typically
 * ignore or send a terse help message.
 */
export type Intent =
  | { kind: "decision"; shortId: string; yes: boolean }
  | { kind: "command"; verb: string; args: string[] }
  | { kind: "unknown" };

const DECISION_RE = /^\s*([0-9A-HJKMNP-TV-Z]{6,8})\s+(y|yes|n|no)\s*$/i;

export function parseIntent(body: string): Intent {
  const m = DECISION_RE.exec(body ?? "");
  if (m) {
    return { kind: "decision", shortId: m[1]!.toUpperCase(), yes: /^y/i.test(m[2]!) };
  }
  const trimmed = (body ?? "").trim();
  if (trimmed.startsWith("!")) {
    const parts = trimmed.slice(1).split(/\s+/);
    const verb = (parts.shift() ?? "").toLowerCase();
    if (!verb) return { kind: "unknown" };
    return { kind: "command", verb, args: parts };
  }
  return { kind: "unknown" };
}

export type CommandHandler = (ctx: CommandContext) => Promise<string> | string;
export interface CommandContext {
  moderatorId: string;
  isSuperAdmin: boolean;
  args: string[];
}

/**
 * v1 registry: only !HELP is wired. Other verbs are recognized as stubs so we
 * can return "not yet available" instead of a generic unknown-command reply.
 */
const HANDLERS: Record<string, CommandHandler> = {
  help: helpCommand,
};

const STUB_VERBS = new Set([
  "add", "remove", "promote", "demote", "list", "status", "feed",
]);

export interface ReplyResult {
  reply: string | null;
  handled: boolean;
  // When a decision was the outcome, caller can audit-attach the flyerId.
  flyerId?: string;
  decision?: "approved" | "rejected" | "already_decided" | "not_found";
}

export async function handleModeratorMessage(fromPhone: string, body: string): Promise<ReplyResult> {
  const m = findModeratorByPhone(fromPhone);
  if (!m) return { reply: null, handled: false };

  const intent = parseIntent(body);

  if (intent.kind === "decision") {
    const res = await decide({
      shortId: intent.shortId,
      moderatorId: m.id,
      decision: intent.yes ? "approved" : "rejected",
    });
    let reply: string;
    switch (res.status) {
      case "approved": reply = `Flyer ${res.shortId} approved.`; break;
      case "rejected": reply = `Flyer ${res.shortId} rejected.`; break;
      case "already_decided": reply = `Flyer ${res.shortId} already handled.`; break;
      case "not_found": reply = `Unknown flyer ID ${res.shortId}.`; break;
    }
    return { reply, handled: true, flyerId: res.flyerId, decision: res.status };
  }

  if (intent.kind === "command") {
    const handler = HANDLERS[intent.verb];
    if (handler) {
      const reply = await handler({ moderatorId: m.id, isSuperAdmin: m.isSuperAdmin, args: intent.args });
      return { reply, handled: true };
    }
    if (STUB_VERBS.has(intent.verb)) {
      return { reply: `!${intent.verb.toUpperCase()} is not yet available. Reply !HELP for supported commands.`, handled: true };
    }
    return { reply: "Unknown command. Reply !HELP for supported commands.", handled: true };
  }

  return { reply: null, handled: false };
}
