/**
 * Deletes a user and all their data: sessions, workouts and sets, body weights, workout presets and custom movements.
 * All of it is one transaction, so a failure leaves the user as they were. See `deleteUserAndData`.
 *
 *   bun run user:delete -- someone@example.com --url postgresql://postgres:postgres@localhost:55433/setlist
 *
 * The database URL is required on the command line. The script never reads .env, so it cannot fall back to the
 * development database by accident: you always say which database you mean. There is no confirmation question, the
 * exact email and the URL are the confirmation. It prints what it removed.
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../prisma/generated/client/client";
import { deleteUserAndData } from "../src/lib/account.server";

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const args = process.argv.slice(2).filter((arg) => arg !== "--");
const urlAt = args.indexOf("--url");
const url = urlAt === -1 ? undefined : args[urlAt + 1];
const rest = args.filter((_, i) => i !== urlAt && i !== urlAt + 1);
if (!url || rest.length !== 1) {
  fail("Usage: bun run user:delete -- <email> --url <database url>");
}
// Emails are stored trimmed and lowercase (see emailSchema), so look for it the same way.
const email = rest[0].trim().toLowerCase();

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
try {
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) fail(`No user with the email ${email} in that database.`);
  const counts = await deleteUserAndData(prisma, user.id);
  // Sets, preset exercises and the like go with their parent and are not counted separately.
  const removed = Object.entries(counts).map(([name, n]) => `${name} ${n}`);
  console.log(`Deleted ${email}. Rows removed: ${removed.join(", ")}.`);
} finally {
  await prisma.$disconnect();
}
