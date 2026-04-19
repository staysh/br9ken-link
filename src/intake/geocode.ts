import { eq } from "drizzle-orm";
import { openDb } from "../db/client.js";
import { geocodeCache } from "../db/schema.js";

export interface GeocodeInput {
  city?: string | undefined;
  state?: string | undefined;
  zip?: string | undefined;
}

export interface GeocodeResult {
  lat: number;
  lon: number;
  source: string;
  cached: boolean;
}

const CENSUS_URL = "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress";
const BENCHMARK = "Public_AR_Current";

function normKey(input: GeocodeInput): string | null {
  const z = input.zip?.trim();
  const c = input.city?.trim().toLowerCase();
  const s = input.state?.trim().toUpperCase();
  if (z && /^\d{5}$/.test(z) && !c) return `zip:${z}`;
  if (c && s) return `addr:${c}|${s}${z ? `|${z}` : ""}`;
  if (z && /^\d{5}$/.test(z)) return `zip:${z}`;
  return null;
}

function addressLine(input: GeocodeInput): string | null {
  const z = input.zip?.trim();
  const c = input.city?.trim();
  const s = input.state?.trim().toUpperCase();
  if (c && s) return `${c}, ${s}${z ? ` ${z}` : ""}`;
  if (z) return z;
  return null;
}

export async function geocode(input: GeocodeInput, opts: { fetchTimeoutMs?: number } = {}): Promise<GeocodeResult | null> {
  const key = normKey(input);
  if (!key) return null;

  const db = openDb();
  const hit = db.select().from(geocodeCache).where(eq(geocodeCache.key, key)).get();
  if (hit) {
    if (hit.miss || hit.lat == null || hit.lon == null) return null;
    return { lat: hit.lat, lon: hit.lon, source: hit.source ?? "cache", cached: true };
  }

  const addr = addressLine(input);
  if (!addr) return null;

  const url = new URL(CENSUS_URL);
  url.searchParams.set("address", addr);
  url.searchParams.set("benchmark", BENCHMARK);
  url.searchParams.set("format", "json");

  const ac = new AbortController();
  const timeout = setTimeout(() => ac.abort(), opts.fetchTimeoutMs ?? 8000);
  let lat: number | null = null;
  let lon: number | null = null;
  try {
    const res = await fetch(url, { signal: ac.signal });
    if (res.ok) {
      const json = (await res.json()) as CensusResponse;
      const match = json?.result?.addressMatches?.[0];
      if (match?.coordinates) {
        lat = match.coordinates.y;
        lon = match.coordinates.x;
      }
    }
  } catch {
    // Network failure: cache as miss so we don't hammer during a sustained outage;
    // caller may retry by deleting the miss row.
  } finally {
    clearTimeout(timeout);
  }

  const now = Date.now();
  if (lat != null && lon != null) {
    db.insert(geocodeCache)
      .values({ key, lat, lon, miss: false, source: "census", resolvedAt: now })
      .onConflictDoUpdate({
        target: geocodeCache.key,
        set: { lat, lon, miss: false, source: "census", resolvedAt: now },
      })
      .run();
    return { lat, lon, source: "census", cached: false };
  }

  db.insert(geocodeCache)
    .values({ key, lat: null, lon: null, miss: true, source: "census", resolvedAt: now })
    .onConflictDoNothing()
    .run();
  return null;
}

interface CensusResponse {
  result?: {
    addressMatches?: Array<{
      coordinates?: { x: number; y: number };
    }>;
  };
}
