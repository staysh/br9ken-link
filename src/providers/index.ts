import { config } from "../config.js";
import type { MessagingProvider } from "./base.js";
import { twilioProvider } from "./twilio.js";

export type { MessagingProvider, InboundMessage, InboundReqLike, FetchedMedia, OutboundRef } from "./base.js";

export function getProvider(name: string = config.MESSAGING_PROVIDER): MessagingProvider {
  switch (name) {
    case "twilio":
      return twilioProvider;
    default:
      throw new Error(`Unknown messaging provider: ${name}`);
  }
}
