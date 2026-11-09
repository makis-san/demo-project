import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "./auth.server";
import { getServerSidePrismaClient } from "./db.server";
import { errorMiddleware } from "./errors.server";

/**
 * The browsers this user is signed in on, this one first and then the most recently used. Expired rows are not
 * listed. The token and its hash never leave the server, and the ids are only useful together with the user's own
 * session: every query below is limited to their user id.
 */
export const getSessionsServerFn = createServerFn()
  .middleware([errorMiddleware, authMiddleware])
  .handler(async ({ context }) => {
    const prisma = await getServerSidePrismaClient();
    const sessions = await prisma.session.findMany({
      where: { userId: context.user.id, expiresAt: { gt: new Date() } },
      select: { id: true, deviceLabel: true, createdAt: true, lastSeenAt: true },
      orderBy: [{ lastSeenAt: "desc" }, { id: "asc" }],
    });
    const list = sessions.map((session) => ({ ...session, isCurrent: session.id === context.sessionId }));
    // Stable, so the rest stay in the order of most recently used.
    return list.sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent));
  });

/** Signs one other browser out. This browser is not allowed here: it signs out with Log out. */
export const revokeSessionServerFn = createServerFn({ method: "POST" })
  .middleware([errorMiddleware, authMiddleware])
  .inputValidator(z.object({ sessionId: z.string() }))
  .handler(async ({ context, data }) => {
    const prisma = await getServerSidePrismaClient();
    const { count } = await prisma.session.deleteMany({
      where: { id: data.sessionId, userId: context.user.id, NOT: { id: context.sessionId } },
    });
    if (count === 0) return { success: false as const, error: "That device is already signed out" };
    return { success: true as const };
  });

/** Signs every other browser out and keeps this one. */
export const revokeOtherSessionsServerFn = createServerFn({ method: "POST" })
  .middleware([errorMiddleware, authMiddleware])
  .handler(async ({ context }) => {
    const prisma = await getServerSidePrismaClient();
    const { count } = await prisma.session.deleteMany({
      where: { userId: context.user.id, NOT: { id: context.sessionId } },
    });
    return { success: true as const, signedOut: count };
  });
