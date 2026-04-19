import { randomInt } from "node:crypto";
import { eq } from "drizzle-orm";
import { openDb } from "../db/client.js";
import { flyer } from "../db/schema.js";

// Crockford base32, minus I, L, O, U.
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function generate(length = 6): string {
  let s = "";
  for (let i = 0; i < length; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return s;
}

/**
 * Generate a short ID that does not currently collide with any pending flyer.
 * The partial unique index on flyer(short_id) WHERE status='pending' is the
 * ultimate arbiter; this retry loop just reduces the probability of losing a
 * race on insert.
 */
export async function generateUniquePending(length = 6, attempts = 8): Promise<string> {
  const db = openDb();
  for (let i = 0; i < attempts; i++) {
    const candidate = generate(length);
    const clash = db
      .select({ id: flyer.id })
      .from(flyer)
      .where(eq(flyer.shortId, candidate))
      .all()
      .find((r) => r); // any row at all; pending vs decided doesn't matter for uniqueness of active codes
    if (!clash) return candidate;
  }
  // Fall back to a longer ID on sustained collisions.
  return generate(length + 2);
}
