import { createServerFn } from "@tanstack/react-start";
import { getServerSidePrismaClient } from "@/lib/db.server";
import { authMiddleware } from "@/lib/auth.server";
import { errorMiddleware } from "@/lib/errors.server";
import { withNumberWeight } from "@/lib/sets.server";
import { bodyWeightSchema } from "@/lib/validation";
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
