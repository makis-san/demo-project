import { createServerFn } from "@tanstack/react-start";
import { getServerSidePrismaClient, isUniqueViolation } from "@/lib/db.server";
import { authMiddleware } from "@/lib/auth.server";
import { errorMiddleware } from "@/lib/errors.server";
import { repsSchema, weightSchema } from "@/lib/validation";
import { withNumberWeight } from "@/lib/sets.server";
import { visibleMovements } from "@/lib/movements.server";
import { z } from "zod";
import { parseTimeline, workoutTimelineSchema, type WorkoutTimeline } from "@/lib/workout-timeline";

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
      // The preset this workout was started from: its series are the checklist of planned sets.
      preset: {
        select: {
          name: true,
          exercises: {
            orderBy: { position: "asc" },
            select: {
              restSeconds: true,
              movement: true,
              sets: { orderBy: { position: "asc" }, select: { id: true, reps: true, weight: true } },
            },
          },
        },
      },
      // The workout this one was repeated from. Its sets are the checklist of planned sets.
      sourceWorkout: {
        select: {
          id: true,
          completedAt: true,
          sets: { include: { movement: true }, orderBy: setOrder },
        },
      },
    },
  });
}

type ActiveWorkout = NonNullable<Awaited<ReturnType<typeof findActiveWorkout>>>;

/** Whether a movement is already in the workout: logged in it, or planned by its preset or the workout it repeats. */
function isInWorkout(workout: ActiveWorkout, movementId: string) {
  return (
    workout.sets.some((set) => set.movementId === movementId) ||
    !!workout.preset?.exercises.some((exercise) => exercise.movement.id === movementId) ||
    !!workout.sourceWorkout?.sets.some((set) => set.movementId === movementId)
  );
}

/**
 * One planned set of the checklist, whichever way the workout was planned. A preset's weight is optional and it carries
 * the rest to take after the set. A repeated workout's sets always have a weight and use the rest the user has set.
 */
export type PlannedSetOut = {
  id: string;
  reps: number;
  weight: number | null;
  restSeconds: number | null;
  movement: ActiveWorkout["sets"][number]["movement"];
};

function toClientWorkout({ sourceWorkout, preset, ...workout }: ActiveWorkout) {
  let plan: { title: string | null; completedAt: Date | null; sets: PlannedSetOut[] } | null = null;
  if (preset) {
    plan = {
      title: preset.name,
      completedAt: null,
      sets: preset.exercises.flatMap((exercise) =>
        exercise.sets.map((set) => ({
          id: set.id,
          reps: set.reps,
          weight: set.weight?.toNumber() ?? null,
          restSeconds: exercise.restSeconds,
          movement: exercise.movement,
        })),
      ),
    };
  } else if (sourceWorkout) {
    plan = {
      title: null,
      completedAt: sourceWorkout.completedAt,
      sets: sourceWorkout.sets.map((set) => ({ ...withNumberWeight(set), restSeconds: null })),
    };
  }
  return { ...workout, timeline: parseTimeline(workout.timeline), sets: workout.sets.map(withNumberWeight), plan };
}

/**
 * Starts a workout, the moment the user presses Start on the screen that shows what it will be. Until then nothing exists:
 * choosing a preset, the workout of the day or a past workout only opens that screen. The new workout remembers where
 * its plan came from, so the planned sets are there for the whole workout and after a reload.
 *
 * Only one workout can be active (a unique index), so with one open this refuses and says so.
 */
export const startWorkoutServerFn = createServerFn({ method: "POST" })
  .middleware([errorMiddleware, authMiddleware])
  .inputValidator(z.object({ presetId: z.string().nullable(), fromWorkoutId: z.string().nullable() }))
  .handler(
    async ({
      context,
      data,
    }: {
      context: { user: { id: string } };
      data: { presetId: string | null; fromWorkoutId: string | null };
    }) => {
      const prisma = await getServerSidePrismaClient();
      const userId = context.user.id;
      if (data.presetId && data.fromWorkoutId)
        return { success: false as const, error: "Pick one thing to start from" };

      if (data.presetId) {
        const preset = await prisma.workoutPreset.findFirst({
          where: { id: data.presetId, userId },
          select: { id: true },
        });
        if (!preset) return { success: false as const, error: "Workout not found" };
      }
      if (data.fromWorkoutId) {
        const source = await prisma.workout.findFirst({
          where: { id: data.fromWorkoutId, userId, completedAt: { not: null } },
          select: { id: true, _count: { select: { sets: true } } },
        });
        if (!source) return { success: false as const, error: "Workout not found" };
        if (source._count.sets === 0) return { success: false as const, error: "That workout has no sets to repeat" };
      }

      try {
        await prisma.workout.create({
          data: { userId, presetId: data.presetId, sourceWorkoutId: data.fromWorkoutId },
        });
      } catch (error) {
        // The unique index on active workouts says one is already open, for example started in another tab.
        if (isUniqueViolation(error)) {
          return { success: false as const, error: "Finish your current workout before starting another" };
        }
        throw error;
      }
      return { success: true as const };
    },
  );

export const getCurrentWorkoutServerFn = createServerFn()
  .middleware([errorMiddleware, authMiddleware])
  .handler(async ({ context }) => {
    const prisma = await getServerSidePrismaClient();
    const workout = await findActiveWorkout(prisma, context.user.id);
    return workout && toClientWorkout(workout);
  });

/**
 * Saves the timeline of the user's open workout, sent by the browser after it saved it locally. Each copy carries the
 * time it was changed, and an older copy than the stored one is ignored: two tabs, or a retry that arrives late, cannot
 * put the ring back in time. A completed workout's timeline is not changed any more.
 */
export const saveWorkoutTimelineServerFn = createServerFn({ method: "POST" })
  .middleware([errorMiddleware, authMiddleware])
  .inputValidator(z.object({ workoutId: z.string(), timeline: workoutTimelineSchema }))
  .handler(
    async ({
      context,
      data,
    }: {
      context: { user: { id: string } };
      data: { workoutId: string; timeline: WorkoutTimeline };
    }) => {
      const prisma = await getServerSidePrismaClient();
      const workout = await prisma.workout.findFirst({
        where: { id: data.workoutId, userId: context.user.id, completedAt: null },
        select: { timeline: true },
      });
      if (!workout) return { success: false as const, error: "No active workout" };
      const stored = parseTimeline(workout.timeline);
      if (stored && stored.updatedAt > data.timeline.updatedAt) return { success: true as const, timeline: stored };
      // completedAt: null again in the write, so a workout completed in between is left alone.
      await prisma.workout.updateMany({
        where: { id: data.workoutId, userId: context.user.id, completedAt: null },
        data: { timeline: data.timeline },
      });
      return { success: true as const, timeline: data.timeline };
    },
  );

/** Completes the open workout. The browser sends its final timeline with it, so the last section and pause are closed. */
export const completeWorkoutServerFn = createServerFn({ method: "POST" })
  .middleware([errorMiddleware, authMiddleware])
  .inputValidator(z.object({ timeline: workoutTimelineSchema.nullable() }))
  .handler(
    async ({ context, data }: { context: { user: { id: string } }; data: { timeline: WorkoutTimeline | null } }) => {
      const prisma = await getServerSidePrismaClient();
      const workout = await findActiveWorkout(prisma, context.user.id);
      if (!workout) {
        return { success: false as const, error: "No active workout to complete" };
      }
      await prisma.workout.update({
        where: { id: workout.id },
        data: { completedAt: new Date(), ...(data.timeline && { timeline: data.timeline }) },
      });
      return { success: true as const };
    },
  );

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
        where: { id: data.movementId, ...visibleMovements(context.user.id) },
        select: { id: true, archivedAt: true },
      });
      if (!movement) {
        return { success: false as const, error: "Movement not found" };
      }
      // An archived movement cannot be picked for a new place, but a workout that already has it (a set of it, or a
      // planned set from its preset or the workout it repeats) can keep logging it, so such a workout still finishes.
      if (movement.archivedAt && !isInWorkout(workout, movement.id)) {
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

/**
 * Changes the weight and reps of a set, in the active workout or a completed one: a typo found later is still a typo.
 * The movement and the place in the list stay (the order is `createdAt`, which is not touched). It checks the same
 * rules as adding a set, and that the set is in one of the user's own workouts.
 */
export const updateSetServerFn = createServerFn({ method: "POST" })
  .middleware([errorMiddleware, authMiddleware])
  .inputValidator(z.object({ setId: z.string(), reps: repsSchema, weight: weightSchema }))
  .handler(
    async ({
      context,
      data,
    }: {
      context: { user: { id: string } };
      data: { setId: string; reps: number; weight: number };
    }) => {
      const prisma = await getServerSidePrismaClient();
      // updateMany with the owner in the filter: another user's set is never touched, and a missing one is just count 0.
      const { count } = await prisma.set.updateMany({
        where: { id: data.setId, workout: { userId: context.user.id } },
        data: { reps: data.reps, weight: data.weight },
      });
      if (count === 0) return { success: false as const, error: "Set not found" };
      const set = await prisma.set.findUniqueOrThrow({ where: { id: data.setId }, include: { movement: true } });
      return { success: true as const, set: withNumberWeight(set) };
    },
  );

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
    // A built-in is shared, so its sets are filtered by the workout's owner too: another user's sets on the same
    // built-in must not put it in this user's table. An archived movement stays: its sets are in the history.
    const movements = await prisma.movement.findMany({
      where: {
        ...visibleMovements(context.user.id),
        sets: { some: { workout: { userId: context.user.id, completedAt: { not: null } } } },
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
