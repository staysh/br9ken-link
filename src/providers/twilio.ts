import twilio from "twilio";
import { extension as mimeExt } from "./mime.js";
import { config } from "../config.js";
import type { MessagingProvider, InboundMessage, InboundReqLike, FetchedMedia, OutboundRef } from "./base.js";

function requireCreds(): { sid: string; token: string; from: string } {
  const sid = config.TWILIO_ACCOUNT_SID;
  const token = config.TWILIO_AUTH_TOKEN;
  const from = config.TWILIO_FROM_NUMBER;
  if (!sid || !token || !from) {
    throw new Error("Twilio credentials not configured (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER).");
  }
  return { sid, token, from };
}

let _client: ReturnType<typeof twilio> | null = null;
function client(): ReturnType<typeof twilio> {
  if (_client) return _client;
  const { sid, token } = requireCreds();
  _client = twilio(sid, token);
  return _client;
}

function headerValue(headers: InboundReqLike["headers"], name: string): string | undefined {
  const v = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(v)) return v[0];
  return v;
}

export const twilioProvider: MessagingProvider = {
  name: "twilio",

  verifySignature(req: InboundReqLike): boolean {
    const token = config.TWILIO_AUTH_TOKEN;
    if (!token) return false;
    const signature = headerValue(req.headers, "x-twilio-signature");
    if (!signature) return false;
    return twilio.validateRequest(token, signature, req.url, req.body);
  },

  parseInbound(req: InboundReqLike): InboundMessage {
    const b = req.body;
    const num = Number.parseInt(b.NumMedia ?? "0", 10) || 0;
    const media = [];
    for (let i = 0; i < num; i++) {
      const url = b[`MediaUrl${i}`];
      const mime = b[`MediaContentType${i}`];
      if (url && mime) media.push({ url, mime });
    }
    return {
      providerSid: b.MessageSid ?? b.SmsMessageSid ?? "",
      from: b.From ?? "",
      to: b.To ?? "",
      body: b.Body ?? "",
      media,
    };
  },

  async fetchMedia(ref: { url: string; mime?: string }): Promise<FetchedMedia> {
    const { sid, token } = requireCreds();
    const auth = Buffer.from(`${sid}:${token}`).toString("base64");
    const res = await fetch(ref.url, { headers: { Authorization: `Basic ${auth}` }, redirect: "follow" });
    if (!res.ok) throw new Error(`Twilio media fetch ${res.status} ${res.statusText}`);
    const mime = ref.mime ?? res.headers.get("content-type") ?? "application/octet-stream";
    const buf = Buffer.from(await res.arrayBuffer());
    const urlPath = new URL(res.url).pathname.split("/").filter(Boolean);
    const last = urlPath[urlPath.length - 1] ?? "media";
    const filename = /\.[a-z0-9]{1,5}$/i.test(last) ? last : `${last}.${mimeExt(mime)}`;
    return { buf, mime, filename };
  },

  async sendText(to: string, body: string): Promise<OutboundRef> {
    const { from } = requireCreds();
    const msg = await client().messages.create({ from, to, body });
    return { providerSid: msg.sid };
  },

  async sendMedia(to: string, body: string, mediaUrls: string[]): Promise<OutboundRef> {
    const { from } = requireCreds();
    const msg = await client().messages.create({ from, to, body, mediaUrl: mediaUrls });
    return { providerSid: msg.sid };
  },
};
