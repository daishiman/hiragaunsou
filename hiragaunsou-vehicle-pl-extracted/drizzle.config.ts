import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: ["./src/infrastructure/db/auth-schema.ts", "./src/infrastructure/db/schema.ts"],
  out: "./migrations",
});
