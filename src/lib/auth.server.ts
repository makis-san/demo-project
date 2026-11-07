import crypto from "node:crypto";
import { redirect } from "@tanstack/react-router";
import { getCookie, setCookie, deleteCookie } from "@tanstack/react-start/server";
import { createMiddleware, createServerFn } from "@tanstack/react-start";
import { sessionCookieName } from "./auth.consts";
import { getServerSidePrismaClient } from "./db.server";
import { z } from "zod";

// In production, use a proper secret from environment variables
const COOKIE_SECRET = process.env.COOKIE_SECRET || "dev-secret-change-in-production";

/**
 * Signs a user ID to create a tamper-proof session token
 */
function signUserId(userId: string): string {
  const signature = crypto.createHmac("sha256", COOKIE_SECRET).update(userId).digest("hex");
  return `${userId}.${signature}`;
}

/**
 * Verifies a signed session token and returns the user ID if valid
 */
function verifySessionToken(token: string): string | null {
  const [userId, signature] = token.split(".");
  if (!userId || !signature) return null;

  const expectedSignature = crypto.createHmac("sha256", COOKIE_SECRET).update(userId).digest("hex");
  if (signature !== expectedSignature) return null;

  return userId;
}

/**
 * Sets the session cookie for a user (internal use only)
 */
function setSessionCookie(userId: string) {
  const token = signUserId(userId);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

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
  const sessionToken = getCookie(sessionCookieName);
  if (!sessionToken) {
    return null;
  }

  const userId = verifySessionToken(sessionToken);
  if (!userId) {
    return null;
  }

  const prisma = await getServerSidePrismaClient();
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true },
  });

  return user;
});

/**
 * Signs in a user with email and password
 */
export const signInServerFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ email: z.string().email(), password: z.string() }))
  .handler(async ({ data }: { data: { email: string; password: string } }) => {
    const { email, password } = data;

    const prisma = await getServerSidePrismaClient();
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user || user.password !== password) {
      return { success: false as const, error: "Invalid email or password" };
    }

    setSessionCookie(user.id);

    return { success: true as const };
  });

/**
 * Creates a new user account
 */
export const createAccountServerFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ email: z.email(), name: z.string().min(1), password: z.string().min(6) }))
  .handler(async ({ data }: { data: { email: string; name: string; password: string } }) => {
    const { email, name, password } = data;

    const prisma = await getServerSidePrismaClient();

    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      return { success: false as const, error: "An account with this email already exists" };
    }

    const user = await prisma.user.create({
      data: { email, name, password },
    });

    setSessionCookie(user.id);

    return { success: true as const };
  });

/**
 * Logs out the current user
 */
export const logoutServerFn = createServerFn({ method: "POST" }).handler(async () => {
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
