import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { deleteUserAndData } from "./account.server";
import { authMiddleware, clearSessionCookie } from "./auth.server";
import { getServerSidePrismaClient } from "./db.server";
import { errorMiddleware } from "./errors.server";
import { hashPassword, verifyPassword } from "./password.server";
import { clientAddress, giveBackSignInAttempt, takeSignInAttempt, tooManyAttempts } from "./rate-limit.server";
import { passwordSchema } from "./validation";

const wrongPassword = { success: false as const, error: "That password is not right" };

/**
 * Checks the signed-in user's password, for the two things below that a session left open on a shared computer
 * must not be enough for. It counts against the same limit as sign-in, since it is the same guess at the same
 * password, and it counts before the check, so a burst of parallel guesses is stopped too. Returns the failure to
 * send back, or null when the password is right. The caller gives the attempt back once its work is done.
 */
async function checkPassword(user: { id: string; email: string }, password: string) {
  if (!takeSignInAttempt(clientAddress(), user.email)) return tooManyAttempts;

  const prisma = await getServerSidePrismaClient();
  const account = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { passwordHash: true } });
  return (await verifyPassword(account.passwordHash, password)) ? null : wrongPassword;
}

/**
 * Sets a new password. The current one is required. Every other browser is signed out, in the same transaction, and
 * this one stays: if someone else had the old password, they are out, and the user is not.
 */
export const changePasswordServerFn = createServerFn({ method: "POST" })
  .middleware([errorMiddleware, authMiddleware])
  .inputValidator(z.object({ currentPassword: z.string().max(128), newPassword: passwordSchema }))
  .handler(async ({ context, data }) => {
    const failure = await checkPassword(context.user, data.currentPassword);
    if (failure) return failure;

    const prisma = await getServerSidePrismaClient();
    const passwordHash = await hashPassword(data.newPassword);
    const [, others] = await prisma.$transaction([
      prisma.user.update({ where: { id: context.user.id }, data: { passwordHash } }),
      prisma.session.deleteMany({ where: { userId: context.user.id, NOT: { id: context.sessionId } } }),
    ]);

    giveBackSignInAttempt(clientAddress(), context.user.email);
    return { success: true as const, signedOut: others.count };
  });

/**
 * Deletes the account and everything in it (see `deleteUserAndData`), then signs this browser out. The password is
 * required, so an open session alone cannot erase someone's history.
 */
export const deleteAccountServerFn = createServerFn({ method: "POST" })
  .middleware([errorMiddleware, authMiddleware])
  .inputValidator(z.object({ password: z.string().max(128) }))
  .handler(async ({ context, data }) => {
    const failure = await checkPassword(context.user, data.password);
    if (failure) return failure;

    await deleteUserAndData(await getServerSidePrismaClient(), context.user.id);
    clearSessionCookie();

    giveBackSignInAttempt(clientAddress(), context.user.email);
    return { success: true as const };
  });
