/**
 * Writes the built-in movements from src/lib/movement-catalog.ts to the database. Safe to run any number of times:
 * it upserts on `slug`, so a second run changes nothing. The container runs it after the migrations on every start,
 * CI runs it before the e2e tests, and `prisma migrate reset` runs it through prisma.config.ts.
 *
 *   bun scripts/seed-movements.ts
 *
 * It also merges a user's own movement into a built-in that has the same name (ignoring case): the user's sets are
 * moved onto the built-in and their copy is deleted, so their history continues under one movement and the library
 * never shows two "Bench Press". This is in the seed and not in the migration because the built-ins only exist once
 * the seed has written them, and because a later release can add a built-in that someone already made by hand.
 */
import { config } from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../prisma/generated/client/client";
import { movementCatalog } from "../src/lib/movement-catalog";

config({ path: [".env.local", ".env"], quiet: true });

export async function seedMovements(prisma: PrismaClient) {
  // A mistake in the catalog should stop the seed, not leave half of it written.
  const slugs = new Set<string>();
  const names = new Set<string>();
  for (const movement of movementCatalog) {
    if (slugs.has(movement.slug)) throw new Error(`Duplicate slug in the catalog: ${movement.slug}`);
    if (names.has(movement.name.toLowerCase())) throw new Error(`Duplicate name in the catalog: ${movement.name}`);
    if (movement.primaryMuscles.length === 0) throw new Error(`${movement.name} has no primary muscle`);
    slugs.add(movement.slug);
    names.add(movement.name.toLowerCase());
  }

  return prisma.$transaction(async (tx) => {
    for (const movement of movementCatalog) {
      const data = {
        name: movement.name,
        isBodyWeight: movement.isBodyWeight,
        equipment: movement.equipment,
        primaryMuscles: movement.primaryMuscles,
        secondaryMuscles: movement.secondaryMuscles,
      };
      await tx.movement.upsert({
        where: { slug: movement.slug },
        create: { slug: movement.slug, userId: null, ...data },
        update: data,
      });
    }

    // Sets first, then the movements they pointed at.
    const moved = await tx.$executeRaw`
      UPDATE "Set" s
      SET "movementId" = b."id"
      FROM "Movement" c
      JOIN "Movement" b ON b."userId" IS NULL AND lower(b."name") = lower(c."name")
      WHERE c."userId" IS NOT NULL AND s."movementId" = c."id"
    `;
    const merged = await tx.$executeRaw`
      DELETE FROM "Movement" c
      USING "Movement" b
      WHERE c."userId" IS NOT NULL AND b."userId" IS NULL AND lower(b."name") = lower(c."name")
    `;
    return { builtIns: movementCatalog.length, mergedMovements: merged, movedSets: moved };
  });
}

if (import.meta.main) {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  try {
    const result = await seedMovements(prisma);
    console.log(
      `Seeded ${result.builtIns} built-in movements` +
        (result.mergedMovements
          ? `, merged ${result.mergedMovements} custom ones (${result.movedSets} sets moved)`
          : ""),
    );
  } finally {
    await prisma.$disconnect();
  }
}
