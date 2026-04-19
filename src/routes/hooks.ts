import type { FastifyInstance, FastifyRequest } from "fastify";
import { eq } from "drizzle-orm";
import { ulid } from "ulid";
import { openDb } from "../db/client.js";
import { inboundMessage, outboundMessage } from "../db/schema.js";
import { getProvider } from "../providers/index.js";
import type { InboundReqLike } from "../providers/base.js";
import { recordInbound, ingestSubmission, normalizePhone } from "../intake/pipeline.js";
import { handleModeratorMessage } from "../moderation/commands/index.js";
import { findModeratorByPhone } from "../moderation/decide.js";
import { config } from "../config.js";
import { audit } from "../util/audit.js";

function toProviderReq(req: FastifyRequest): InboundReqLike {
  // Twilio validates against the full URL it dispatched to. PUBLIC_BASE_URL is
  // the authoritative origin; req.url carries path+querystring.
  const url = `${config.PUBLIC_BASE_URL.replace(/\/$/, "")}${req.url}`;
  return {
    url,
    headers: req.headers as Record<string, string | string[] | undefined>,
    body: (req.body ?? {}) as Record<string, string>,
  };
}

export async function hooksRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Params: { provider: string } }>("/hooks/:provider/inbound", async (req, reply) => {
    const providerName = req.params.provider;
    let provider;
    try {
      provider = getProvider(providerName);
    } catch {
      return reply.code(404).send("unknown provider");
    }

    const pReq = toProviderReq(req);
    if (config.NODE_ENV === "production" && !provider.verifySignature(pReq)) {
      return reply.code(403).send("bad signature");
    }

    const msg = provider.parseInbound(pReq);
    if (!msg.providerSid) return reply.code(400).send("missing message sid");

    const fresh = recordInbound({
      providerSid: msg.providerSid,
      provider: provider.name,
      from: normalizePhone(msg.from),
      to: msg.to,
      body: msg.body,
    });
    if (!fresh) {
      return reply.code(200).type("text/xml").send("<Response/>");
    }

    // Acknowledge immediately; do the work after the response flushes.
    reply.code(200).type("text/xml").send("<Response/>");

    queueMicrotask(async () => {
      try {
        await routeInbound(msg);
        markInboundProcessed(msg.providerSid);
      } catch (e) {
        req.log.error({ err: e, providerSid: msg.providerSid }, "inbound processing failed");
      }
    });

    return reply;
  });

  app.post<{ Params: { provider: string } }>("/hooks/:provider/status", async (req, reply) => {
    // Twilio status callbacks: accept and forget in v1; the outbound_message row
    // suffices for lookups. We could later update delivered/failed state here.
    return reply.code(200).type("text/xml").send("<Response/>");
  });
}

async function routeInbound(msg: { providerSid: string; from: string; to: string; body: string; media: Array<{ url: string; mime: string }> }): Promise<void> {
  const from = normalizePhone(msg.from);
  const mod = findModeratorByPhone(from);

  if (mod) {
    const res = await handleModeratorMessage(from, msg.body);
    if (res.reply) await sendReply(from, res.reply, res.flyerId);
    return;
  }

  await ingestSubmission({ ...msg, from });
}

async function sendReply(to: string, body: string, flyerId?: string): Promise<void> {
  const provider = getProvider();
  try {
    const out = await provider.sendText(to, body);
    openDb().insert(outboundMessage).values({
      id: ulid(),
      provider: provider.name,
      providerSid: out.providerSid,
      toPhone: to,
      body,
      kind: "reply",
      flyerId: flyerId ?? null,
      sentAt: Date.now(),
    }).run();
  } catch (e) {
    audit({ actorKind: "system", verb: "reply.failed", subjectKind: "phone", subjectId: to, meta: { err: e instanceof Error ? e.message : String(e) } });
  }
}

function markInboundProcessed(providerSid: string): void {
  openDb().update(inboundMessage).set({ processedAt: Date.now() }).where(eq(inboundMessage.providerSid, providerSid)).run();
}
