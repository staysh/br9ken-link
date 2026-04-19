import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type Database from "better-sqlite3";
import { openDb, rawDb, loadSpatialite } from "./client.js";
import { config } from "../config.js";

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Run the base SQL in init.sql and then add SpatiaLite geometry columns and
 * spatial indexes on flyer and moderator if they don't already exist.
 *
 * Idempotent: safe to run on every boot.
 */
export function runInit(): { spatialite: boolean; addedGeom: string[] } {
  openDb();
  const db = rawDb();

  const sql = readFileSync(join(HERE, "init.sql"), "utf8");
  db.exec(sql);

  const addedGeom: string[] = [];
  const spatialite = initSpatial(db, addedGeom);
  return { spatialite, addedGeom };
}

function initSpatial(db: Database.Database, added: string[]): boolean {
  // Ensure SpatiaLite is loaded; if it isn't, return false so callers (e.g. `flyer
  // doctor`) can surface the problem. Not fatal in development.
  const loaded = loadSpatialite(db, config.SPATIALITE_PATH);
  if (!loaded.ok) return false;

  db.prepare("SELECT InitSpatialMetaData(1)").get();

  for (const table of ["flyer", "moderator"]) {
    const has = db
      .prepare("SELECT 1 FROM geometry_columns WHERE f_table_name = ? AND f_geometry_column = 'geom'")
      .get(table);
    if (!has) {
      db.prepare("SELECT AddGeometryColumn(?, 'geom', 4326, 'POINT', 'XY')").get(table);
      db.prepare("SELECT CreateSpatialIndex(?, 'geom')").get(table);
      added.push(table);
    }
  }
  return true;
}

/** Update the `geom` column from (lat, lon) for a single row. */
export function syncGeom(table: "flyer" | "moderator", id: string, lat: number | null, lon: number | null): void {
  const db = rawDb();
  if (lat == null || lon == null) {
    db.prepare(`UPDATE ${table} SET geom = NULL WHERE id = ?`).run(id);
    return;
  }
  db.prepare(`UPDATE ${table} SET geom = MakePoint(?, ?, 4326) WHERE id = ?`).run(lon, lat, id);
}
