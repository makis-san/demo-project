import { createServerFn } from "@tanstack/react-start";
import { getServerSidePrismaClient, isForeignKeyViolation, isUniqueViolation } from "@/lib/db.server";
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
 * Which movements a user can see: their own, and the built-in ones, which have no owner. Reading is
 * "mine or built-in" everywhere. Changing is "mine" only (`deleteMovementServerFn` filters by the owner), so a
 * built-in cannot be changed from here. It includes archived movements, because a past workout, the history, a chart
 * or a preset that uses one must still find it.
 */
export const visibleMovements = (userId: string) => ({ OR: [{ userId }, { userId: null }] });

/**
 * The movements a user can choose for something new: the visible ones that are not archived. Every list the user picks
 * from uses this, and anything that shows what they already did uses `visibleMovements`.
 */
export const pickableMovements = (userId: string) => ({ ...visibleMovements(userId), archivedAt: null });

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
      // An archived movement still holds the user's name (the name is unique per user), and it still holds their sets.
      // Creating the name again brings that row back, with the new details, instead of failing or making a second one,
      // so the old sets are under the movement again.
      const archived = await prisma.movement.findFirst({
        where: { userId: context.user.id, archivedAt: { not: null }, name: { equals: data.name, mode: "insensitive" } },
        select: { id: true },
      });
      const fields = {
        name: data.name,
        isBodyWeight: data.isBodyWeight,
        equipment: data.equipment,
        primaryMuscles: data.primaryMuscles,
        secondaryMuscles: data.secondaryMuscles,
      };
      if (archived) {
        const movement = await prisma.movement.update({
          where: { id: archived.id },
          data: { ...fields, archivedAt: null },
          select: movementSelect,
        });
        return { success: true as const, restored: true, movement: toClientMovement(movement) };
      }
      const movement = await prisma.movement.create({
        data: { ...fields, userId: context.user.id },
        select: movementSelect,
      });
      return { success: true as const, restored: false, movement: toClientMovement(movement) };
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
      where: pickableMovements(context.user.id),
      select: movementSelect,
      orderBy: { name: "asc" },
    });
    return movements.map(toClientMovement);
  });

const catalogBySlug = new Map(movementCatalog.map((movement) => [movement.slug, movement]));

/**
 * One movement for its page: the fields from the database and, for a built-in, the steps, the "watch for" line and
 * the animation poses from the catalog. Those are presentation data kept in code, so they are looked up by slug. A custom
 * movement has no guide. Null when the movement does not exist or is another user's. An archived movement is still
 * found, so a link to it from a past workout works, and it says it is archived.
 */
export const getMovementServerFn = createServerFn()
  .middleware([errorMiddleware, authMiddleware])
  .inputValidator(z.object({ movementId: z.string() }))
  .handler(async ({ context, data }: { context: { user: { id: string } }; data: { movementId: string } }) => {
    const prisma = await getServerSidePrismaClient();
    const movement = await prisma.movement.findFirst({
      where: { id: data.movementId, ...visibleMovements(context.user.id) },
      select: {
        ...movementSelect,
        slug: true,
        archivedAt: true,
        _count: { select: { sets: true, presetExercises: true } },
      },
    });
    if (!movement) return null;
    const { slug, archivedAt, _count, ...fields } = movement;
    const entry = slug ? catalogBySlug.get(slug) : undefined;
    return {
      ...toClientMovement(fields),
      isArchived: archivedAt !== null,
      // Whether deleting it would archive it instead. Only for the owner's own movement: for a built-in the counts
      // would say whether other users log it.
      inUse: movement.userId !== null && _count.sets + _count.presetExercises > 0,
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
          ...pickableMovements(context.user.id),
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

/**
 * Deletes a custom movement, or archives it when deleting would erase history. A movement that is in no set and no preset
 * is removed. One that is used anywhere is kept with `archivedAt` set, so past workouts, the history, the charts, the
 * personal records and the presets that contain it stay whole, and it leaves the library and the pickers. A built-in
 * is shared and is never changed, and another user's movement is "not found", like an unknown id.
 */
export const deleteMovementServerFn = createServerFn({ method: "POST" })
  .middleware([errorMiddleware, authMiddleware])
  .inputValidator(z.object({ movementId: z.string() }))
  .handler(async ({ context, data }: { context: { user: { id: string } }; data: { movementId: string } }) => {
    const prisma = await getServerSidePrismaClient();
    const userId = context.user.id;
    // The owner is in every filter below, so a movement that is not the user's is never touched.
    const own = await prisma.movement.findFirst({ where: { id: data.movementId, userId }, select: { id: true } });
    if (!own) {
      const builtIn = await prisma.movement.findFirst({
        where: { id: data.movementId, userId: null },
        select: { id: true },
      });
      return {
        success: false as const,
        error: builtIn ? "Built-in movements cannot be deleted" : "Movement not found",
      };
    }

    const archive = async () => {
      await prisma.movement.updateMany({ where: { id: own.id, userId }, data: { archivedAt: new Date() } });
      return { success: true as const, outcome: "archived" as const };
    };

    try {
      // The unused check is part of the delete, so a set added a moment ago makes it delete nothing instead of failing.
      const { count } = await prisma.movement.deleteMany({
        where: { id: own.id, userId, sets: { none: {} }, presetExercises: { none: {} } },
      });
      if (count === 1) return { success: true as const, outcome: "deleted" as const };
    } catch (error) {
      // A set or a preset was added between the filter and the delete, and the foreign key refused. It is used now.
      if (!isForeignKeyViolation(error)) throw error;
    }
    return archive();
  });
