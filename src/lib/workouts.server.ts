import { createServerFn } from "@tanstack/react-start";
import { getServerSidePrismaClient, isUniqueViolation } from "@/lib/db.server";
import { authMiddleware } from "@/lib/auth.server";
import { errorMiddleware } from "@/lib/errors.server";
import { repsSchema, weightSchema } from "@/lib/validation";
import { withNumberWeight } from "@/lib/sets.server";
import { z } from "zod";

// createdAt alone can tie for sets added in the same millisecond, so id breaks the tie.
const setOrder = [{ createdAt: "asc" as const }, { id: "asc" as const }];

type DbClient = Awaited<ReturnType<typeof getServerSidePrismaClient>>;

/**
 * The user's one active workout, or null. A unique index allows at most one
 * per user, so no ordering is needed to pick between several.
 */
function findActiveWorkout(prisma: DbClient, userId: string) {
  return prisma.workout.findFirst({
    where: { userId, completedAt: null },
    include: {
      sets: {
        include: { movement: true },
        orderBy: setOrder,
      },
    },
  });
}

type ActiveWorkout = NonNullable<Awaited<ReturnType<typeof findActiveWorkout>>>;

function toClientWorkout(workout: ActiveWorkout) {
  return { ...workout, sets: workout.sets.map(withNumberWeight) };
}

export const createWorkoutServerFn = createServerFn({ method: "POST" })
  .middleware([errorMiddleware, authMiddleware])
  .handler(async ({ context }) => {
    const prisma = await getServerSidePrismaClient();
    try {
      await prisma.workout.create({ data: { userId: context.user.id } });
    } catch (error) {
      // The unique index on active workouts rejected a second one, for example
      // from a double click or a second tab. The existing one is what the user wants.
      if (!isUniqueViolation(error)) throw error;
    }
    const workout = await findActiveWorkout(prisma, context.user.id);
    if (!workout) throw new Error("Active workout not found after creating it");
    return { success: true, workout: toClientWorkout(workout) };
  });

export const getCurrentWorkoutServerFn = createServerFn()
  .middleware([errorMiddleware, authMiddleware])
  .handler(async ({ context }) => {
    const prisma = await getServerSidePrismaClient();
    const workout = await findActiveWorkout(prisma, context.user.id);
    return workout && toClientWorkout(workout);
  });

export const completeWorkoutServerFn = createServerFn({ method: "POST" })
  .middleware([errorMiddleware, authMiddleware])
  .handler(async ({ context }) => {
    const prisma = await getServerSidePrismaClient();
    const workout = await findActiveWorkout(prisma, context.user.id);
    if (!workout) {
      return { success: false as const, error: "No active workout to complete" };
    }
    await prisma.workout.update({
      where: { id: workout.id },
      data: { completedAt: new Date() },
    });
    return { success: true as const };
  });

export const addSetServerFn = createServerFn({ method: "POST" })
  .middleware([errorMiddleware, authMiddleware])
  .inputValidator(z.object({ movementId: z.string(), reps: repsSchema, weight: weightSchema }))
  .handler(
    async ({
      context,
      data,
    }: {
      context: { user: { id: string } };
      data: { movementId: string; reps: number; weight: number };
    }) => {
      const prisma = await getServerSidePrismaClient();
      const workout = await findActiveWorkout(prisma, context.user.id);
      if (!workout) {
        return { success: false as const, error: "No active workout" };
      }
      const movement = await prisma.movement.findFirst({
        where: { id: data.movementId, userId: context.user.id },
        select: { id: true },
      });
      if (!movement) {
        return { success: false as const, error: "Movement not found" };
      }
      const set = await prisma.set.create({
        data: {
          workoutId: workout.id,
          movementId: data.movementId,
          reps: data.reps,
          weight: data.weight,
        },
        include: { movement: true },
      });
      return { success: true as const, set: withNumberWeight(set) };
    },
  );

export const deleteSetServerFn = createServerFn({ method: "POST" })
  .middleware([errorMiddleware, authMiddleware])
  .inputValidator(z.object({ setId: z.string() }))
  .handler(async ({ context, data }: { context: { user: { id: string } }; data: { setId: string } }) => {
    const prisma = await getServerSidePrismaClient();
    // Verify the set belongs to the user's active workout
    const set = await prisma.set.findFirst({
      where: { id: data.setId, workout: { userId: context.user.id, completedAt: null } },
    });
    if (!set) {
      return { success: false as const, error: "Set not found" };
    }
    await prisma.set.delete({ where: { id: data.setId } });
    return { success: true as const };
  });

/** How many completed workouts one page of history holds. */
export const historyPageSize = 20;

/** Where the next page starts: the last workout of the page before it. */
const historyCursorSchema = z.object({ completedAt: z.coerce.date(), id: z.string() });
export type HistoryCursor = z.infer<typeof historyCursorSchema>;

/**
 * One page of the user's completed workouts, newest first.
 *
 * The order is `completedAt` and then `id`, because two workouts can be
 * completed in the same millisecond and the order must be the same every time
 * the query runs. The cursor is the (completedAt, id) of the last workout of the
 * previous page, and the page is everything after it in that order. So a workout
 * is never listed twice or skipped, even when several share one `completedAt`,
 * and a workout completed in between does not shift the following pages.
 *
 * One extra row is read to know whether there is a next page.
 */
export const getWorkoutHistoryServerFn = createServerFn()
  .middleware([errorMiddleware, authMiddleware])
  .inputValidator(z.object({ cursor: historyCursorSchema.nullable() }))
  .handler(async ({ context, data }: { context: { user: { id: string } }; data: { cursor: HistoryCursor | null } }) => {
    const prisma = await getServerSidePrismaClient();
    const { cursor } = data;
    const rows = await prisma.workout.findMany({
      where: {
        userId: context.user.id,
        completedAt: { not: null },
        ...(cursor && {
          OR: [{ completedAt: { lt: cursor.completedAt } }, { completedAt: cursor.completedAt, id: { lt: cursor.id } }],
        }),
      },
      orderBy: [{ completedAt: "desc" }, { id: "desc" }],
      take: historyPageSize + 1,
      include: {
        sets: {
          include: { movement: true },
          orderBy: setOrder,
        },
      },
    });

    const hasMore = rows.length > historyPageSize;
    const workouts = rows.slice(0, historyPageSize).map((workout) => ({
      ...workout,
      sets: workout.sets.map(withNumberWeight),
    }));
    const last = workouts.at(-1);
    const nextCursor: HistoryCursor | null =
      hasMore && last?.completedAt ? { completedAt: last.completedAt, id: last.id } : null;
    return { workouts, nextCursor };
  });

/**
 * Every movement that is in a completed workout, by name. The history page uses it for the columns
 * of the table and the chart's movement list. It cannot come from the pages, because they hold only
 * the newest workouts.
 */
export const getHistoryMovementsServerFn = createServerFn()
  .middleware([errorMiddleware, authMiddleware])
  .handler(async ({ context }) => {
    const prisma = await getServerSidePrismaClient();
    const movements = await prisma.movement.findMany({
      where: {
        userId: context.user.id,
        sets: { some: { workout: { completedAt: { not: null } } } },
      },
      select: { id: true, name: true },
    });
    return movements.sort((a, b) => a.name.localeCompare(b.name));
  });

export const deleteWorkoutsServerFn = createServerFn({ method: "POST" })
  .middleware([errorMiddleware, authMiddleware])
  .inputValidator(z.object({ workoutIds: z.array(z.string()) }))
  .handler(async ({ context, data }: { context: { user: { id: string } }; data: { workoutIds: string[] } }) => {
    const prisma = await getServerSidePrismaClient();
    // Only this user's workouts. Their sets are removed by the database in the same statement
    // (ON DELETE CASCADE), so a failure cannot leave a workout without its sets.
    await prisma.workout.deleteMany({
      where: { id: { in: data.workoutIds }, userId: context.user.id },
    });
    return { success: true };
  });
