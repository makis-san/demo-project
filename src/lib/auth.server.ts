import crypto from "node:crypto";
import { redirect } from "@tanstack/react-router";
import { getCookie, getRequestHeader, setCookie, deleteCookie } from "@tanstack/react-start/server";
import { createMiddleware, createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { sessionCookieName } from "./auth.consts";
import { configService } from "./config.server";
import { getServerSidePrismaClient, isUniqueViolation } from "./db.server";
import { deviceLabel } from "./device-label";
import { errorMiddleware } from "./errors.server";
import { emailSchema, passwordSchema } from "./validation";
import { z } from "zod";
import { hashPassword, verifyAgainstDummy, verifyPassword } from "./password.server";
import {
  clientAddress,
  giveBackSignInAttempt,
  giveBackSignUpAttempt,
  takeSignInAttempt,
  takeSignUpAttempt,
  tooManyAttempts,
} from "./rate-limit.server";

const hourMs = 60 * 60 * 1000;
const dayMs = 24 * hourMs;

/** How long a session lasts without use. Using the app pushes this forward, see `currentSession`. */
const sessionLifetimeMs = 7 * dayMs;
/** How long a session lasts at most, however much it is used. After this the user signs in again. */
const sessionMaxAgeMs = 30 * dayMs;
/** The most often a session's row is written to by page loads. */
const touchIntervalMs = hourMs;

/**
 * Secure keeps the cookie off plain HTTP. It is on unless ENVIRONMENT says
 * development, so a deployment that forgets to set it gets the safe flag, and
 * localhost keeps working without HTTPS.
 */
function cookieOptions() {
  return {
    httpOnly: true,
    secure: configService.getAppConfig().environment !== "development",
    sameSite: "lax" as const,
  };
}

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

  await prisma.session.create({
    data: { tokenHash: hashToken(token), userId, expiresAt, deviceLabel: deviceLabel(getRequestHeader("user-agent")) },
  });
  // Expired rows are already refused by the lookup below, this only keeps the table small.
  await prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });

  setCookie(sessionCookieName, token, { ...cookieOptions(), expires: expiresAt });
}

/**
 * Signs this browser out: the cookie goes, and the caller deletes the row if there is one. It is exported for
 * another server file, and an export stays in the browser's bundle even when nothing there uses it, which would
 * pull the server-only cookie code in with it. `createServerOnlyFn` leaves an empty stub in the browser.
 */
export const clearSessionCookie = createServerOnlyFn(() => {
  deleteCookie(sessionCookieName, cookieOptions());
});

/**
 * The session of this request's cookie and its user, or null when there is no valid one.
 *
 * Valid means the row exists, has not expired, and was made less than 30 days ago. The 30 days are checked on their
 * own and not left to `expiresAt`, so a stolen token that keeps being used still stops working: sliding expiry alone
 * would let it live forever.
 *
 * Using the app also slides the expiry: the first request after an hour since the last write sets `lastSeenAt` to now
 * and `expiresAt` to seven days from now, but never past the 30 days, and sends the cookie again with the new date.
 * The write is limited to once an hour, otherwise every page load would write to the database. It is an
 * `updateMany` on the old `lastSeenAt`, so requests that arrive together do not all write, only one wins.
 */
async function currentSession() {
  const token = getCookie(sessionCookieName);
  if (!token) return null;

  const prisma = await getServerSidePrismaClient();
  const now = Date.now();
  const session = await prisma.session.findFirst({
    where: {
      tokenHash: hashToken(token),
      expiresAt: { gt: new Date(now) },
      createdAt: { gt: new Date(now - sessionMaxAgeMs) },
    },
    select: { id: true, createdAt: true, lastSeenAt: true, user: { select: { id: true, email: true, name: true } } },
  });
  if (!session) return null;

  if (now - session.lastSeenAt.getTime() >= touchIntervalMs) {
    const expiresAt = new Date(Math.min(now + sessionLifetimeMs, session.createdAt.getTime() + sessionMaxAgeMs));
    const { count } = await prisma.session.updateMany({
      where: { id: session.id, lastSeenAt: session.lastSeenAt },
      data: { lastSeenAt: new Date(now), expiresAt },
    });
    if (count === 1) setCookie(sessionCookieName, token, { ...cookieOptions(), expires: expiresAt });
  }

  return { id: session.id, user: session.user };
}

/**
 * Gets the current user from session cookie. The root route calls it on every
 * page load, so it needs the error middleware too: without it a database error
 * went to the browser, in the response and in the HTML of the page.
 * @returns User object or null if not logged in
 */
export const getUserServerFn = createServerFn()
  .middleware([errorMiddleware])
  .handler(async () => {
    const session = await currentSession();
    return session?.user ?? null;
  });

/**
 * Signs in a user with email and password
 */
export const signInServerFn = createServerFn({ method: "POST" })
  .middleware([errorMiddleware])
  .inputValidator(z.object({ email: emailSchema, password: z.string().max(128) }))
  .handler(async ({ data }: { data: { email: string; password: string } }) => {
    const { email, password } = data;

    // Before any work is done, so refused attempts cost nothing.
    const ip = clientAddress();
    if (!takeSignInAttempt(ip, email)) return tooManyAttempts;

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

    giveBackSignInAttempt(ip, email);
    await startSession(user.id);

    return { success: true as const };
  });

/**
 * Creates a new user account
 */
export const createAccountServerFn = createServerFn({ method: "POST" })
  .middleware([errorMiddleware])
  .inputValidator(z.object({ email: emailSchema, name: z.string().min(1), password: passwordSchema }))
  .handler(async ({ data }: { data: { email: string; name: string; password: string } }) => {
    const { email, name, password } = data;

    const ip = clientAddress();
    if (!takeSignUpAttempt(ip)) return tooManyAttempts;

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

    giveBackSignUpAttempt(ip);
    await startSession(user.id);

    return { success: true as const };
  });

/**
 * Logs out the current user. A POST made by the Log out button. There is no
 * page for it, so opening a URL cannot sign anyone out.
 */
export const logoutServerFn = createServerFn({ method: "POST" })
  .middleware([errorMiddleware])
  .handler(async () => {
    const token = getCookie(sessionCookieName);
    if (token) {
      // Deleting the row is what signs out: a copy of the token stops working too.
      const prisma = await getServerSidePrismaClient();
      await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
    }
    clearSessionCookie();
    return { success: true };
  });

/**
 * Authentication middleware that ensures user is logged in. It puts the user and the id of the session that made
 * the request on the context. The id is for "this device" on the Account page and is not sent to the browser.
 * @throws Redirects to sign-in page if not authenticated
 */
export const authMiddleware = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const session = await currentSession();
  if (!session) {
    throw redirect({ to: "/sign-in" });
  }

  return next({
    context: { user: session.user, sessionId: session.id },
  });
});
