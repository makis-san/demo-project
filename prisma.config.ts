import path from "node:path";
import { config } from "dotenv";
import { defineConfig, env } from "prisma/config";

config({ path: [".env.local", ".env"], quiet: true });

export default defineConfig({
  schema: path.join(__dirname, "prisma", "schema.prisma"),
  migrations: {
    // Run by `prisma migrate dev` and `prisma migrate reset`, so a fresh database has the built-in movements.
    seed: "bun scripts/seed-movements.ts",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
