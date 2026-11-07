import { createServerFn } from "@tanstack/react-start";
import { getServerSidePrismaClient } from "@/lib/db.server";
import { authMiddleware } from "@/lib/auth.server";
import { z } from "zod";

export const createMovementServerFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator(z.object({ name: z.string().trim().min(1).max(100) }))
  .handler(async ({ context, data }: { context: { user: { id: string } }; data: { name: string } }) => {
    const prisma = await getServerSidePrismaClient();
    try {
      const movement = await prisma.movement.create({
        data: { name: data.name, userId: context.user.id },
      });
      return { success: true as const, movement };
    } catch (error) {
      // P2002 is Prisma's unique constraint error: this user already has the name.
      if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
        return { success: false as const, error: "You already have a movement with this name" };
      }
      throw error;
    }
  });

export const getMovementsServerFn = createServerFn()
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const prisma = await getServerSidePrismaClient();
    return prisma.movement.findMany({
      where: { userId: context.user.id },
      orderBy: { name: "asc" },
    });
  });
