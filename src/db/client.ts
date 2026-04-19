import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "../config.js";
import * as schema from "./schema.js";

export type DB = BetterSQLite3Database<typeof schema> & { $client: Database.Database };

let _db: DB | null = null;
let _raw: Database.Database | null = null;

function ensureParentDir(path: string): void {
  try { mkdirSync(dirname(path), { recursive: true }); } catch { /* ignore */ }
}

/**
 * Load the SpatiaLite extension. SpatiaLite is required for geocoding/distance
 * queries; absence is a hard error in production but is logged and allowed to
 * pass in tests/dev so `flyer doctor` can report it cleanly.
 */
export function loadSpatialite(db: Database.Database, path = config.SPATIALITE_PATH): { ok: boolean; error?: string } {
  try {
    db.loadExtension(path);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function openDb(opts: { readonly?: boolean; skipSpatialite?: boolean } = {}): DB {
  if (_db && !opts.readonly) return _db;

  ensureParentDir(config.DATABASE_URL);
  const raw = new Database(config.DATABASE_URL, { readonly: opts.readonly ?? false });
  raw.pragma("journal_mode = WAL");
  raw.pragma("foreign_keys = ON");
  raw.pragma("synchronous = NORMAL");
  raw.pragma("busy_timeout = 5000");

  if (!opts.skipSpatialite) {
    // SpatiaLite requires extension loading to be enabled on the connection.
    // `allowExtension` is a better-sqlite3-specific gate.
    (raw as unknown as { loadExtension: (p: string) => void }).loadExtension; // type nudge
    raw.pragma("trusted_schema = ON");
    const res = loadSpatialite(raw);
    if (!res.ok && config.NODE_ENV === "production") {
      throw new Error(`SpatiaLite failed to load from "${config.SPATIALITE_PATH}": ${res.error}`);
    }
  }

  const db = drizzle(raw, { schema }) as DB;
  db.$client = raw;
  if (!opts.readonly) {
    _db = db;
    _raw = raw;
  }
  return db;
}

export function rawDb(): Database.Database {
  if (!_raw) openDb();
  return _raw!;
}

export function closeDb(): void {
  if (_raw) {
    _raw.close();
    _raw = null;
    _db = null;
  }
}
