/**
 * Provider-agnostic messaging interface. All messaging vendors (Twilio first)
 * must implement this so the rest of the app can be vendor-neutral.
 */

export interface InboundMedia {
  url: string;
  mime: string;
}

export interface InboundMessage {
  providerSid: string;
  from: string;
  to: string;
  body: string;
  media: InboundMedia[];
}

/**
 * Minimal shape of the HTTP request a provider needs for parse/verify.
 * Decoupled from Fastify so providers stay framework-free.
 */
export interface InboundReqLike {
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: Record<string, string>;
}

export interface OutboundRef {
  providerSid: string;
}

export interface FetchedMedia {
  buf: Buffer;
  mime: string;
  filename: string;
}

export interface MessagingProvider {
  readonly name: string;
  verifySignature(req: InboundReqLike): boolean;
  parseInbound(req: InboundReqLike): InboundMessage;
  fetchMedia(ref: { url: string; mime?: string }): Promise<FetchedMedia>;
  sendText(to: string, body: string): Promise<OutboundRef>;
  sendMedia(to: string, body: string, mediaUrls: string[]): Promise<OutboundRef>;
}
