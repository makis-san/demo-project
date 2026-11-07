// One-off: replaces plaintext passwords left over from before hashing with
// argon2id hashes. Safe to run again, it only touches rows that are not
// already argon2id hashes.
//
// Usage: bun run db:hash-passwords

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../prisma/generated/client/client";
import { hashPassword } from "../src/lib/password.server";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

try {
  const users = await prisma.user.findMany({
    where: { NOT: { passwordHash: { startsWith: "$argon2id$" } } },
    select: { id: true, passwordHash: true },
  });

  for (const user of users) {
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(user.passwordHash) },
    });
  }

  console.log(`Hashed ${users.length} plaintext password(s).`);
} finally {
  await prisma.$disconnect();
}
