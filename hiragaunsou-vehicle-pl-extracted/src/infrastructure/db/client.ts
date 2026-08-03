import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";
import * as authSchema from "./auth-schema";

/** D1バインディングから drizzle クライアントを作る。Infrastructure層のみがこの関数を呼ぶ。 */
export function createDb(d1: D1Database) {
  return drizzle(d1, { schema: { ...schema, ...authSchema } });
}

export type Db = ReturnType<typeof createDb>;
