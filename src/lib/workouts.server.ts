import { createServerFn } from "@tanstack/react-start";
import { getServerSidePrismaClient } from "@/lib/db.server";
import { authMiddleware } from "@/lib/auth.server";
import { errorMiddleware } from "@/lib/errors.server";
import { repsSchema, weightSchema } from "@/lib/validation";
import { withNumberWeight } from "@/lib/sets.server";
import { z } from "zod";

// createdAt alone can tie for sets added in the same millisecond, so id breaks the tie.
const setOrder = [{ createdAt: "asc" as const }, { id: "asc" as const }];

export const createWorkoutServerFn = createServerFn({ method: "POST" })
  .middleware([errorMiddleware, authMiddleware])
  .handler(async ({ context }) => {
    const prisma = await getServerSidePrismaClient();
    const workout = await prisma.workout.create({
      data: {
        userId: context.user.id,
      },
    });
    return { success: true, workout };
  });

export const getCurrentWorkoutServerFn = createServerFn()
  .middleware([errorMiddleware, authMiddleware])
  .handler(async ({ context }) => {
    const prisma = await getServerSidePrismaClient();
    // Get the most recent workout for the user
    const workout = await prisma.workout.findFirst({
      where: { userId: context.user.id, completedAt: null },
      orderBy: { id: "desc" },
      include: {
        sets: {
          include: { movement: true },
          orderBy: setOrder,
        },
      },
    });
    return workout && { ...workout, sets: workout.sets.map(withNumberWeight) };
  });

export const completeWorkoutServerFn = createServerFn({ method: "POST" })
  .middleware([errorMiddleware, authMiddleware])
  .handler(async ({ context }) => {
    const prisma = await getServerSidePrismaClient();
    const workout = await prisma.workout.findFirst({
      where: { userId: context.user.id, completedAt: null },
    });
    if (!workout) {
      return { success: false, error: "No active workout to complete" };
    }
    await prisma.workout.update({
      where: { id: workout.id },
      data: { completedAt: new Date() },
    });
    return { success: true };
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
      const workout = await prisma.workout.findFirst({
        where: { userId: context.user.id, completedAt: null },
      });
      if (!workout) {
        return { success: false, error: "No active workout" };
      }
      const movement = await prisma.movement.findFirst({
        where: { id: data.movementId, userId: context.user.id },
        select: { id: true },
      });
      if (!movement) {
        return { success: false, error: "Movement not found" };
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
      return { success: true, set: withNumberWeight(set) };
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
      return { success: false, error: "Set not found" };
    }
    await prisma.set.delete({ where: { id: data.setId } });
    return { success: true };
  });

export const getWorkoutHistoryServerFn = createServerFn()
  .middleware([errorMiddleware, authMiddleware])
  .handler(async ({ context }) => {
    const prisma = await getServerSidePrismaClient();
    const workouts = await prisma.workout.findMany({
      where: { userId: context.user.id, completedAt: { not: null } },
      orderBy: { completedAt: "desc" },
      include: {
        sets: {
          include: { movement: true },
          orderBy: setOrder,
        },
      },
    });
    return workouts.map((workout) => ({ ...workout, sets: workout.sets.map(withNumberWeight) }));
  });

export const deleteWorkoutsServerFn = createServerFn({ method: "POST" })
  .middleware([errorMiddleware, authMiddleware])
  .inputValidator(z.object({ workoutIds: z.array(z.string()) }))
  .handler(async ({ context, data }: { context: { user: { id: string } }; data: { workoutIds: string[] } }) => {
    const prisma = await getServerSidePrismaClient();
    // Delete sets first, then workouts (only for this user's workouts)
    await prisma.set.deleteMany({
      where: { workout: { id: { in: data.workoutIds }, userId: context.user.id } },
    });
    await prisma.workout.deleteMany({
      where: { id: { in: data.workoutIds }, userId: context.user.id },
    });
    return { success: true };
  });
