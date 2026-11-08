import { createServerFn } from "@tanstack/react-start";
import { getServerSidePrismaClient } from "@/lib/db.server";
import { authMiddleware } from "@/lib/auth.server";
import { errorMiddleware } from "@/lib/errors.server";
import { withNumberWeight } from "@/lib/sets.server";
import { bodyWeightSchema, recordedAtSchema } from "@/lib/validation";
import { z } from "zod";

export const getBodyWeightsServerFn = createServerFn()
  .middleware([errorMiddleware, authMiddleware])
  .handler(async ({ context }) => {
    const prisma = await getServerSidePrismaClient();
    const entries = await prisma.bodyWeight.findMany({
      where: { userId: context.user.id },
      select: { id: true, weight: true, recordedAt: true },
      orderBy: [{ recordedAt: "asc" }, { id: "asc" }],
    });
    return entries.map(withNumberWeight);
  });

export const addBodyWeightServerFn = createServerFn({ method: "POST" })
  .middleware([errorMiddleware, authMiddleware])
  .inputValidator(z.object({ weight: bodyWeightSchema }))
  .handler(async ({ context, data }: { context: { user: { id: string } }; data: { weight: number } }) => {
    const prisma = await getServerSidePrismaClient();
    const entry = await prisma.bodyWeight.create({
      data: { userId: context.user.id, weight: data.weight },
      select: { id: true, weight: true, recordedAt: true },
    });
    return { success: true as const, entry: withNumberWeight(entry) };
  });

/** Changes an entry's weight and date, with the rules of adding one. Another user's entry is never touched. */
export const updateBodyWeightServerFn = createServerFn({ method: "POST" })
  .middleware([errorMiddleware, authMiddleware])
  .inputValidator(z.object({ id: z.string(), weight: bodyWeightSchema, recordedAt: recordedAtSchema }))
  .handler(
    async ({
      context,
      data,
    }: {
      context: { user: { id: string } };
      data: { id: string; weight: number; recordedAt: Date };
    }) => {
      const prisma = await getServerSidePrismaClient();
      const { count } = await prisma.bodyWeight.updateMany({
        where: { id: data.id, userId: context.user.id },
        data: { weight: data.weight, recordedAt: data.recordedAt },
      });
      if (count === 0) return { success: false as const, error: "Entry not found" };
      const entry = await prisma.bodyWeight.findUniqueOrThrow({
        where: { id: data.id },
        select: { id: true, weight: true, recordedAt: true },
      });
      return { success: true as const, entry: withNumberWeight(entry) };
    },
  );

export const deleteBodyWeightServerFn = createServerFn({ method: "POST" })
  .middleware([errorMiddleware, authMiddleware])
  .inputValidator(z.object({ id: z.string() }))
  .handler(async ({ context, data }: { context: { user: { id: string } }; data: { id: string } }) => {
    const prisma = await getServerSidePrismaClient();
    // deleteMany with the user id means another user's entry is never touched.
    const { count } = await prisma.bodyWeight.deleteMany({ where: { id: data.id, userId: context.user.id } });
    if (count === 0) return { success: false as const, error: "Entry not found" };
    return { success: true as const };
  });

/** The user's most recently recorded body weight, or null when they have none. */
export const getLatestBodyWeightServerFn = createServerFn()
  .middleware([errorMiddleware, authMiddleware])
  .handler(async ({ context }) => {
    const prisma = await getServerSidePrismaClient();
    const latest = await prisma.bodyWeight.findFirst({
      where: { userId: context.user.id },
      select: { weight: true },
      orderBy: [{ recordedAt: "desc" }, { id: "desc" }],
    });
    return latest ? latest.weight.toNumber() : null;
  });
