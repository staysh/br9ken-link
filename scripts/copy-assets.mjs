#!/usr/bin/env node
// Copies template/asset files that tsc does not emit into dist/ so the compiled
// code can find them at the same relative paths as in src/.
import { cpSync, copyFileSync, mkdirSync, existsSync } from "node:fs";

mkdirSync("dist/src/db", { recursive: true });
cpSync("src/views", "dist/src/views", { recursive: true });
cpSync("src/public", "dist/src/public", { recursive: true });
if (existsSync("src/db/init.sql")) copyFileSync("src/db/init.sql", "dist/src/db/init.sql");

console.log("assets copied to dist/");
