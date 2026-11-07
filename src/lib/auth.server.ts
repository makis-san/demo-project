import crypto from "node:crypto";
import { redirect } from "@tanstack/react-router";
import { getCookie, setCookie, deleteCookie } from "@tanstack/react-start/server";
import { createMiddleware, createServerFn } from "@tanstack/react-start";
import { sessionCookieName } from "./auth.consts";
import { getServerSidePrismaClient, isUniqueViolation } from "./db.server";
import { emailSchema } from "./validation";
import { z } from "zod";
import { hashPassword, verifyAgainstDummy, verifyPassword } from "./password.server";

const sessionLifetimeMs = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * What the database stores for a session token. The token is 32 random bytes,
 * so it cannot be guessed and a fast hash is enough. A slow one like argon2 is
 * for passwords, which people choose and can be guessed.
 */
function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * Signs the user in on this browser: stores a new session and sets the cookie.
 * Every call makes a new random token, so a token seen before sign-in is never
 * reused afterwards.
 */
async function startSession(userId: string) {
  const prisma = await getServerSidePrismaClient();
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + sessionLifetimeMs);

  await prisma.session.create({ data: { tokenHash: hashToken(token), userId, expiresAt } });
  // Expired rows are already refused by the lookup below, this only keeps the table small.
  await prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });

  setCookie(sessionCookieName, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    expires: expiresAt,
  });
}

/**
 * Gets the current user from session cookie
 * @returns User object or null if not logged in
 */
export const getUserServerFn = createServerFn().handler(async () => {
  const token = getCookie(sessionCookieName);
  if (!token) {
    return null;
  }

  const prisma = await getServerSidePrismaClient();
  const session = await prisma.session.findFirst({
    where: { tokenHash: hashToken(token), expiresAt: { gt: new Date() } },
    select: { user: { select: { id: true, email: true, name: true } } },
  });

  return session?.user ?? null;
});

/**
 * Signs in a user with email and password
 */
export const signInServerFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ email: emailSchema, password: z.string().max(128) }))
  .handler(async ({ data }: { data: { email: string; password: string } }) => {
    const { email, password } = data;

    const prisma = await getServerSidePrismaClient();
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      await verifyAgainstDummy(password);
      return { success: false as const, error: "Invalid email or password" };
    }

    if (!(await verifyPassword(user.passwordHash, password))) {
      return { success: false as const, error: "Invalid email or password" };
    }

    await startSession(user.id);

    return { success: true as const };
  });

/**
 * Creates a new user account
 */
export const createAccountServerFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ email: emailSchema, name: z.string().min(1), password: z.string().min(6).max(128) }))
  .handler(async ({ data }: { data: { email: string; name: string; password: string } }) => {
    const { email, name, password } = data;

    const prisma = await getServerSidePrismaClient();

    const emailTaken = { success: false as const, error: "An account with this email already exists" };

    // Looking first avoids hashing a password for an email that is taken. Two
    // requests can still pass this check together, so the unique index has the
    // final say and its violation gets the same answer.
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      return emailTaken;
    }

    let user;
    try {
      user = await prisma.user.create({
        data: { email, name, passwordHash: await hashPassword(password) },
      });
    } catch (error) {
      if (isUniqueViolation(error)) return emailTaken;
      throw error;
    }

    await startSession(user.id);

    return { success: true as const };
  });

/**
 * Logs out the current user
 */
export const logoutServerFn = createServerFn({ method: "POST" }).handler(async () => {
  const token = getCookie(sessionCookieName);
  if (token) {
    // Deleting the row is what signs out: a copy of the token stops working too.
    const prisma = await getServerSidePrismaClient();
    await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  }
  deleteCookie(sessionCookieName);
  return { success: true };
});

/**
 * Authentication middleware that ensures user is logged in
 * @throws Redirects to sign-in page if not authenticated
 */
export const authMiddleware = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const user = await getUserServerFn();
  if (!user) {
    throw redirect({ to: "/sign-in" });
  }

  return next({
    context: { user },
  });
});
