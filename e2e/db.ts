import { config } from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../prisma/generated/client/client";

config({ path: [".env.local", ".env"], quiet: true });

let client: PrismaClient | undefined;

/** Direct database access for the few things the UI cannot do, such as back-dating a workout. */
export function getDb() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  client ??= new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  return client;
}
