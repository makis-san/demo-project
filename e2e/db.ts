import { randomBytes } from "node:crypto";
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

/**
 * Makes the database refuse some writes, so a test can see what the app does when something it cannot
 * predict fails. The failure is a trigger that raises an error. `when` is a SQL condition on the row (`NEW`
 * for an insert, `OLD` for a delete) and must match only this test's own data, because tests run in
 * parallel on one database. Returns a function that removes the trigger again, call it in a `finally`.
 *
 * `AFTER DELETE` fires at the end of the statement, after the rows that cascade from it were removed,
 * so it shows whether a delete that already did some work is undone.
 */
export async function breakWrites(
  table: "User" | "Session" | "Workout",
  when: "BEFORE INSERT" | "AFTER DELETE",
  condition: string,
) {
  const db = getDb();
  const name = `e2e_break_${randomBytes(4).toString("hex")}`;
  await db.$executeRawUnsafe(
    `CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected failure'; END $$`,
  );
  await db.$executeRawUnsafe(
    `CREATE TRIGGER ${name} ${when} ON "${table}" FOR EACH ROW WHEN (${condition}) EXECUTE FUNCTION ${name}()`,
  );
  return async () => {
    await db.$executeRawUnsafe(`DROP TRIGGER ${name} ON "${table}"`);
    await db.$executeRawUnsafe(`DROP FUNCTION ${name}()`);
  };
}
