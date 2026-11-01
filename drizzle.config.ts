import { defineConfig } from "drizzle-kit";

// Only used to generate SQL migrations into ./drizzle (pnpm db:generate). The app applies them
// itself on start (scripts/start.mjs); tests apply them to throwaway databases.
export default defineConfig({
  schema: "./db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
});
