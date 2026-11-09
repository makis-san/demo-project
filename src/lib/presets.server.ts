import { createServerFn } from "@tanstack/react-start";
import { getServerSidePrismaClient, isUniqueViolation } from "@/lib/db.server";
import { authMiddleware } from "@/lib/auth.server";
import { errorMiddleware } from "@/lib/errors.server";
import { resolveTimeZone } from "@/lib/request-timezone.server";
import { pickableMovements, visibleMovements } from "@/lib/movements.server";
import { repsSchema, weightSchema } from "@/lib/validation";
import type { Equipment, MuscleGroup } from "@/lib/muscles";
import { maxExercisesPerPreset, maxSetsPerExercise, restSecondsSchema } from "@/lib/presets";
import { z } from "zod";

/** A series: reps, and a weight that is optional, a value to help track progress and never required. */
const presetSetSchema = z.object({ reps: repsSchema, weight: weightSchema.nullable() });
const presetExerciseSchema = z.object({
  movementId: z.string(),
  restSeconds: restSecondsSchema,
  sets: z.array(presetSetSchema).min(1).max(maxSetsPerExercise),
});

const savePresetSchema = z.object({
  id: z.string().nullable(),
  name: z.string().trim().min(1).max(60),
  exercises: z.array(presetExerciseSchema).min(1).max(maxExercisesPerPreset),
  /** ISO weekdays, 1 Monday to 7 Sunday, this preset is the workout of the day on. */
  weekdays: z
    .array(z.int().min(1).max(7))
    .max(7)
    .transform((days) => [...new Set(days)].sort()),
});
type SavePresetInput = z.infer<typeof savePresetSchema>;

const movementFields = {
  id: true,
  userId: true,
  name: true,
  isBodyWeight: true,
  equipment: true,
  primaryMuscles: true,
  secondaryMuscles: true,
} as const;

function movementOut<T extends { userId: string | null }>({ userId, ...movement }: T) {
  return { ...movement, isBuiltIn: userId === null };
}

/**
 * Saves a preset to the user's library: creates it, or replaces the one with `id`. The movements, series and weekdays are
 * all written in one transaction, so the preset is never half saved. Editing replaces the series rather than diffing
 * them, which keeps the editor simple: what is on the screen is what is stored.
 */
export const savePresetServerFn = createServerFn({ method: "POST" })
  .middleware([errorMiddleware, authMiddleware])
  .inputValidator(savePresetSchema)
  .handler(async ({ context, data }: { context: { user: { id: string } }; data: SavePresetInput }) => {
    const prisma = await getServerSidePrismaClient();
    const userId = context.user.id;

    // Every movement must be one the user can see: their own or a built-in. A foreign id is the same as an unknown one.
    // An archived one is refused for a new place, but a preset that already holds it keeps it when it is saved again.
    const ids = [...new Set(data.exercises.map((e) => e.movementId))];
    const visible = await prisma.movement.count({
      where: {
        id: { in: ids },
        AND: [
          visibleMovements(userId),
          {
            OR: [
              { archivedAt: null },
              ...(data.id ? [{ presetExercises: { some: { presetId: data.id, preset: { userId } } } }] : []),
            ],
          },
        ],
      },
    });
    if (visible !== ids.length) return { success: false as const, error: "Movement not found" };

    if (data.id) {
      const own = await prisma.workoutPreset.findFirst({ where: { id: data.id, userId }, select: { id: true } });
      if (!own) return { success: false as const, error: "Workout not found" };
    }

    const exercises = {
      create: data.exercises.map((exercise, i) => ({
        movementId: exercise.movementId,
        position: i,
        restSeconds: exercise.restSeconds,
        sets: { create: exercise.sets.map((set, j) => ({ position: j, reps: set.reps, weight: set.weight })) },
      })),
    };
    const days = { create: data.weekdays.map((weekday) => ({ weekday })) };

    try {
      const preset = await prisma.$transaction(async (tx) => {
        if (!data.id) {
          return tx.workoutPreset.create({ data: { userId, name: data.name, exercises, days }, select: { id: true } });
        }
        // Exercises, series and days go with the delete (ON DELETE CASCADE) and are written again.
        await tx.presetExercise.deleteMany({ where: { presetId: data.id } });
        await tx.presetDay.deleteMany({ where: { presetId: data.id } });
        return tx.workoutPreset.update({
          where: { id: data.id },
          data: { name: data.name, exercises, days },
          select: { id: true },
        });
      });
      return { success: true as const, id: preset.id };
    } catch (error) {
      if (isUniqueViolation(error)) {
        return { success: false as const, error: "You already have a workout with this name" };
      }
      throw error;
    }
  });

/** The user's workout library, by name, with what the cards need: a summary and the weekdays. */
export const getPresetsServerFn = createServerFn()
  .middleware([errorMiddleware, authMiddleware])
  .handler(async ({ context }) => {
    const prisma = await getServerSidePrismaClient();
    const presets = await prisma.workoutPreset.findMany({
      where: { userId: context.user.id },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      select: {
        id: true,
        name: true,
        days: { select: { weekday: true }, orderBy: { weekday: "asc" } },
        exercises: {
          orderBy: { position: "asc" },
          select: {
            movement: { select: { name: true, primaryMuscles: true, secondaryMuscles: true } },
            _count: { select: { sets: true } },
          },
        },
      },
    });
    return presets.map((preset) => ({
      id: preset.id,
      name: preset.name,
      weekdays: preset.days.map((d) => d.weekday),
      exerciseCount: preset.exercises.length,
      setCount: preset.exercises.reduce((sum, e) => sum + e._count.sets, 0),
      movements: preset.exercises.map((e) => e.movement),
    }));
  });

/** One preset in full, for the editor. Null when it does not exist or is another user's. */
export const getPresetServerFn = createServerFn()
  .middleware([errorMiddleware, authMiddleware])
  .inputValidator(z.object({ presetId: z.string() }))
  .handler(async ({ context, data }: { context: { user: { id: string } }; data: { presetId: string } }) => {
    const prisma = await getServerSidePrismaClient();
    const preset = await prisma.workoutPreset.findFirst({
      where: { id: data.presetId, userId: context.user.id },
      select: {
        id: true,
        name: true,
        days: { select: { weekday: true } },
        exercises: {
          orderBy: { position: "asc" },
          select: {
            id: true,
            restSeconds: true,
            movement: { select: movementFields },
            sets: { orderBy: { position: "asc" }, select: { id: true, reps: true, weight: true } },
          },
        },
      },
    });
    if (!preset) return null;
    return {
      id: preset.id,
      name: preset.name,
      weekdays: preset.days.map((d) => d.weekday).sort(),
      exercises: preset.exercises.map((e) => ({
        id: e.id,
        restSeconds: e.restSeconds,
        movement: movementOut(e.movement),
        sets: e.sets.map((s) => ({ id: s.id, reps: s.reps, weight: s.weight?.toNumber() ?? null })),
      })),
    };
  });

/**
 * Movements by id, for a new workout started from the movements selected on the Movements page. Archived ones are left
 * out: a new workout is built from the library, which does not list them.
 */
export const getMovementsByIdServerFn = createServerFn()
  .middleware([errorMiddleware, authMiddleware])
  .inputValidator(z.object({ ids: z.array(z.string()).max(maxExercisesPerPreset) }))
  .handler(async ({ context, data }: { context: { user: { id: string } }; data: { ids: string[] } }) => {
    const prisma = await getServerSidePrismaClient();
    const movements = await prisma.movement.findMany({
      where: { id: { in: data.ids }, ...pickableMovements(context.user.id) },
      select: movementFields,
    });
    // In the order asked for.
    return data.ids.flatMap((id) => movements.filter((m) => m.id === id).map(movementOut));
  });

export const deletePresetServerFn = createServerFn({ method: "POST" })
  .middleware([errorMiddleware, authMiddleware])
  .inputValidator(z.object({ presetId: z.string() }))
  .handler(async ({ context, data }: { context: { user: { id: string } }; data: { presetId: string } }) => {
    const prisma = await getServerSidePrismaClient();
    // The owner is in the filter: another user's preset is never touched. Its workouts keep their sets and lose the link.
    const { count } = await prisma.workoutPreset.deleteMany({ where: { id: data.presetId, userId: context.user.id } });
    if (count === 0) return { success: false as const, error: "Workout not found" };
    return { success: true as const };
  });

/**
 * What a workout would be, before it exists: the plan the Start screen shows. From a preset, from a past workout
 * (the old "repeat"), or empty. Nothing is created, so looking at it costs nothing and starts no clock.
 */
type PreviewMovement = {
  id: string;
  name: string;
  isBodyWeight: boolean;
  isBuiltIn: boolean;
  equipment: Equipment | null;
  primaryMuscles: MuscleGroup[];
  secondaryMuscles: MuscleGroup[];
};
type PreviewExercise = {
  movement: PreviewMovement;
  restSeconds: number | null;
  sets: { reps: number; weight: number | null }[];
};

export const getWorkoutPreviewServerFn = createServerFn()
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
      const active = await prisma.workout.findFirst({ where: { userId, completedAt: null }, select: { id: true } });
      const hasActiveWorkout = !!active;
      const emptyExercises: PreviewExercise[] = [];
      if (data.presetId) {
        const preset = await prisma.workoutPreset.findFirst({
          where: { id: data.presetId, userId },
          select: {
            name: true,
            exercises: {
              orderBy: { position: "asc" },
              select: {
                restSeconds: true,
                movement: { select: movementFields },
                sets: { orderBy: { position: "asc" }, select: { reps: true, weight: true } },
              },
            },
          },
        });
        if (!preset) return null;
        return {
          kind: "preset" as const,
          title: preset.name,
          subtitle: null as string | null,
          hasActiveWorkout,
          exercises: preset.exercises.map(
            (e): PreviewExercise => ({
              movement: movementOut(e.movement),
              restSeconds: e.restSeconds,
              sets: e.sets.map((s) => ({ reps: s.reps, weight: s.weight?.toNumber() ?? null })),
            }),
          ),
        };
      }

      if (data.fromWorkoutId) {
        const source = await prisma.workout.findFirst({
          where: { id: data.fromWorkoutId, userId, completedAt: { not: null } },
          select: {
            completedAt: true,
            sets: {
              orderBy: [{ createdAt: "asc" }, { id: "asc" }],
              select: { reps: true, weight: true, movement: { select: movementFields } },
            },
          },
        });
        if (!source || source.sets.length === 0) return null;
        // The sets grouped by movement, in the order each was first lifted.
        const groups: PreviewExercise[] = [];
        for (const set of source.sets) {
          const existing = groups.find((g) => g.movement.id === set.movement.id);
          const out = { reps: set.reps, weight: set.weight.toNumber() as number | null };
          if (existing) existing.sets.push(out);
          else groups.push({ movement: movementOut(set.movement), restSeconds: null, sets: [out] });
        }
        return {
          kind: "repeat" as const,
          title: "Repeat a past workout",
          subtitle: source.completedAt?.toISOString() ?? null,
          hasActiveWorkout,
          exercises: groups,
        };
      }

      return {
        kind: "empty" as const,
        title: "Empty workout",
        subtitle: null as string | null,
        hasActiveWorkout,
        exercises: emptyExercises,
      };
    },
  );

export type WorkoutPreview = NonNullable<Awaited<ReturnType<typeof getWorkoutPreviewServerFn>>>;

/**
 * The workouts of the day: the presets that have today's weekday, today meaning the user's own day in their timezone.
 * `doneToday` says whether a workout started from that preset was completed today, so the home screen can show it as done.
 */
export const getTodayServerFn = createServerFn()
  .middleware([errorMiddleware, authMiddleware])
  .handler(async ({ context }: { context: { user: { id: string } } }) => {
    const prisma = await getServerSidePrismaClient();
    const timeZone = resolveTimeZone();
    const userId = context.user.id;
    const [[{ weekday, today }], doneRows] = await prisma.$transaction([
      prisma.$queryRaw<{ weekday: number; today: string }[]>`
        SELECT
          EXTRACT(ISODOW FROM (now() AT TIME ZONE ${timeZone}))::int AS "weekday",
          to_char((now() AT TIME ZONE ${timeZone})::date, 'YYYY-MM-DD') AS "today"
      `,
      prisma.$queryRaw<{ presetId: string }[]>`
        SELECT DISTINCT w."presetId" AS "presetId"
        FROM "Workout" w
        WHERE w."userId" = ${userId}
          AND w."presetId" IS NOT NULL
          AND w."completedAt" IS NOT NULL
          AND (w."completedAt" AT TIME ZONE 'UTC' AT TIME ZONE ${timeZone})::date = (now() AT TIME ZONE ${timeZone})::date
      `,
    ]);
    const done = new Set(doneRows.map((r) => r.presetId));
    const presets = await prisma.workoutPreset.findMany({
      where: { userId, days: { some: { weekday } } },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      select: {
        id: true,
        name: true,
        exercises: {
          orderBy: { position: "asc" },
          select: {
            movement: { select: { name: true, primaryMuscles: true, secondaryMuscles: true } },
            _count: { select: { sets: true } },
          },
        },
      },
    });
    return {
      weekday,
      today,
      workouts: presets.map((p) => ({
        id: p.id,
        name: p.name,
        exerciseCount: p.exercises.length,
        setCount: p.exercises.reduce((sum, e) => sum + e._count.sets, 0),
        movements: p.exercises.map((e) => e.movement),
        doneToday: done.has(p.id),
      })),
    };
  });
