import { createServerFn } from "@tanstack/react-start";
import { getServerSidePrismaClient, isUniqueViolation } from "@/lib/db.server";
import { authMiddleware } from "@/lib/auth.server";
import { errorMiddleware } from "@/lib/errors.server";
import { z } from "zod";

export const createMovementServerFn = createServerFn({ method: "POST" })
  .middleware([errorMiddleware, authMiddleware])
  .inputValidator(z.object({ name: z.string().trim().min(1).max(100), isBodyWeight: z.boolean().default(false) }))
  .handler(
    async ({ context, data }: { context: { user: { id: string } }; data: { name: string; isBodyWeight: boolean } }) => {
      const prisma = await getServerSidePrismaClient();
      try {
        const movement = await prisma.movement.create({
          data: { name: data.name, isBodyWeight: data.isBodyWeight, userId: context.user.id },
        });
        return { success: true as const, movement };
      } catch (error) {
        if (isUniqueViolation(error)) {
          return { success: false as const, error: "You already have a movement with this name" };
        }
        throw error;
      }
    },
  );

export const getMovementsServerFn = createServerFn()
  .middleware([errorMiddleware, authMiddleware])
  .handler(async ({ context }) => {
    const prisma = await getServerSidePrismaClient();
    return prisma.movement.findMany({
      where: { userId: context.user.id },
      orderBy: { name: "asc" },
    });
  });
