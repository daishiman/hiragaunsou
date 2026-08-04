import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../../../src/infrastructure/db/schema";

/**
 * D1(drizzle-orm/d1)は vitest の node 環境では動かせないため、
 * スキーマ互換の better-sqlite3 + drizzle-orm/better-sqlite3 で
 * migrations/ 配下の実SQLをそのまま流し込んだ in-memory DB を作る。
 *
 * 手書きの CREATE TABLE を都度書くと migrations/schema.ts とズレる恐れがあるため、
 * 本物のマイグレーションファイルを適用する(googleSignInFlow.test.ts と同じ方針)。
 *
 * 制約: D1固有の `.batch()` はこのドライバに存在しないため、
 * upsertMany 等 `.batch()` を使うメソッドはこの手法では検証できない(既存実装・対象外)。
 */
export function createTestDb() {
  const sqlite = new Database(":memory:");
  const dir = resolve(__dirname, "../../../migrations");
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files) {
    const sql = readFileSync(resolve(dir, file), "utf8");
    for (const stmt of sql.split("--> statement-breakpoint")) {
      const trimmed = stmt.trim();
      if (trimmed) sqlite.exec(trimmed);
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { sqlite, db: drizzle(sqlite, { schema }) as any };
}
