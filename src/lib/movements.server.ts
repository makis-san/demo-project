import { createServerFn } from "@tanstack/react-start";
import { getServerSidePrismaClient, isUniqueViolation } from "@/lib/db.server";
import { authMiddleware } from "@/lib/auth.server";
import { errorMiddleware } from "@/lib/errors.server";
import { movementCatalog } from "@/lib/movement-catalog";
import {
  categorySchema,
  equipmentSchema,
  musclesOfCategory,
  muscleListSchema,
  musclesAreDisjoint,
  type MovementCategory,
} from "@/lib/muscles";
import { z } from "zod";

/**
 * Which movements a user can see and log: their own, and the built-in ones, which have no owner. Reading is
 * "mine or built-in" everywhere. Changing is "mine" only, and there is no function that renames or deletes a
 * movement, so a built-in cannot be changed from here.
 */
export const visibleMovements = (userId: string) => ({ OR: [{ userId }, { userId: null }] });

/** What the client gets of a movement: its fields, and whether it is a built-in. The owner's id stays on the server. */
const movementSelect = {
  id: true,
  userId: true,
  name: true,
  isBodyWeight: true,
  equipment: true,
  primaryMuscles: true,
  secondaryMuscles: true,
} as const;

function toClientMovement<T extends { userId: string | null }>({ userId, ...movement }: T) {
  return { ...movement, isBuiltIn: userId === null };
}

const createMovementSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    isBodyWeight: z.boolean().default(false),
    equipment: equipmentSchema.nullable().default(null),
    primaryMuscles: muscleListSchema,
    secondaryMuscles: muscleListSchema,
  })
  .refine(musclesAreDisjoint, "A muscle cannot be both primary and secondary");

type CreateMovementInput = z.infer<typeof createMovementSchema>;

export const createMovementServerFn = createServerFn({ method: "POST" })
  .middleware([errorMiddleware, authMiddleware])
  .inputValidator(createMovementSchema)
  .handler(async ({ context, data }: { context: { user: { id: string } }; data: CreateMovementInput }) => {
    const prisma = await getServerSidePrismaClient();
    // The library never lists two movements with one name, so a custom movement cannot take a built-in's name.
    // The database cannot check this across two rows, so it is checked here, and the seed merges any that slip in.
    const builtIn = await prisma.movement.findFirst({
      where: { userId: null, name: { equals: data.name, mode: "insensitive" } },
      select: { name: true },
    });
    if (builtIn) {
      return { success: false as const, error: `${builtIn.name} is already in the library. Pick it from the list.` };
    }
    try {
      const movement = await prisma.movement.create({
        data: {
          name: data.name,
          isBodyWeight: data.isBodyWeight,
          equipment: data.equipment,
          primaryMuscles: data.primaryMuscles,
          secondaryMuscles: data.secondaryMuscles,
          userId: context.user.id,
        },
        select: movementSelect,
      });
      return { success: true as const, movement: toClientMovement(movement) };
    } catch (error) {
      if (isUniqueViolation(error)) {
        return { success: false as const, error: "You already have a movement with this name" };
      }
      throw error;
    }
  });

export const getMovementsServerFn = createServerFn()
  .middleware([errorMiddleware, authMiddleware])
  .handler(async ({ context }) => {
    const prisma = await getServerSidePrismaClient();
    const movements = await prisma.movement.findMany({
      where: visibleMovements(context.user.id),
      select: movementSelect,
      orderBy: { name: "asc" },
    });
    return movements.map(toClientMovement);
  });

const catalogBySlug = new Map(movementCatalog.map((movement) => [movement.slug, movement]));

/**
 * One movement for its page: the fields from the database and, for a built-in, the steps, the "watch for" line and
 * the animation poses from the catalog. Those are presentation data kept in code, so they are looked up by slug. A custom
 * movement has no guide. Null when the movement does not exist or is another user's.
 */
export const getMovementServerFn = createServerFn()
  .middleware([errorMiddleware, authMiddleware])
  .inputValidator(z.object({ movementId: z.string() }))
  .handler(async ({ context, data }: { context: { user: { id: string } }; data: { movementId: string } }) => {
    const prisma = await getServerSidePrismaClient();
    const movement = await prisma.movement.findFirst({
      where: { id: data.movementId, ...visibleMovements(context.user.id) },
      select: { ...movementSelect, slug: true },
    });
    if (!movement) return null;
    const { slug, ...fields } = movement;
    const entry = slug ? catalogBySlug.get(slug) : undefined;
    return {
      ...toClientMovement(fields),
      guide: entry ? { steps: entry.steps, watch: entry.watch, figure: entry.figure ?? null } : null,
    };
  });

/** How many movements one page of the picker holds. */
export const movementSearchPageSize = 20;

/**
 * One page of the movements a user can pick, filtered by name and body part, for the picker in the workout. The library has about
 * a hundred built-ins and a user can add their own, so the picker asks for a page at a time and the server does
 * the filtering, instead of sending all of them to the browser. The order is name and then id, and the cursor is
 * the id of the last row of the page before, so a movement is never listed twice or skipped.
 * One extra row is read to know whether there is a next page.
 */
export const searchMovementsServerFn = createServerFn()
  .middleware([errorMiddleware, authMiddleware])
  .inputValidator(
    z.object({
      search: z.string().trim().max(100),
      cursor: z.string().nullable(),
      category: categorySchema.nullable(),
    }),
  )
  .handler(
    async ({
      context,
      data,
    }: {
      context: { user: { id: string } };
      data: { search: string; cursor: string | null; category: MovementCategory | null };
    }) => {
      const prisma = await getServerSidePrismaClient();
      const rows = await prisma.movement.findMany({
        where: {
          ...visibleMovements(context.user.id),
          ...(data.search && { name: { contains: data.search, mode: "insensitive" as const } }),
          // A body-part tab: the movement works one of its muscles as a primary muscle.
          ...(data.category && { primaryMuscles: { hasSome: [...musclesOfCategory(data.category)] } }),
        },
        select: movementSelect,
        orderBy: [{ name: "asc" }, { id: "asc" }],
        take: movementSearchPageSize + 1,
        ...(data.cursor && { cursor: { id: data.cursor }, skip: 1 }),
      });
      const hasMore = rows.length > movementSearchPageSize;
      const page = rows.slice(0, movementSearchPageSize);
      return { movements: page.map(toClientMovement), nextCursor: hasMore ? page[page.length - 1].id : null };
    },
  );
