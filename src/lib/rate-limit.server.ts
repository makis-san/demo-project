import { getRequestHeader, getRequestIP } from "@tanstack/react-start/server";

/**
 * Limits on sign-in and sign-up attempts, kept in this process's memory.
 *
 * What this does not cover:
 * - A restart forgets every counter.
 * - With several server instances each one counts on its own, so the real limit is
 *   the number of instances times the numbers below. A shared store such as Redis
 *   or a database table would fix that.
 * - An attacker with many IP addresses gets the limit once per address.
 *
 * Each attempt is counted when it starts, not when it fails. The password check
 * takes a while, so counting after it would let a burst of parallel requests
 * all pass before the first one was counted. Attempts that work are given back.
 */

const windowMs = 15 * 60 * 1000;
const maxPerEmailAndIp = 5; // guesses at one account from one address
const maxPerIp = 200; // failed attempts of any kind from one address

type Counter = { count: number; resetAt: number };
const counters = new Map<string, Counter>();

/** The window starts at the first attempt and is not extended by later ones. */
function takeAttempt(key: string, limit: number): boolean {
  const now = Date.now();
  let counter = counters.get(key);

  if (!counter || counter.resetAt <= now) {
    // Drop expired entries now and then, so keys that are never seen again do not pile up.
    if (counters.size > 10_000) {
      for (const [oldKey, old] of counters) if (old.resetAt <= now) counters.delete(oldKey);
    }
    counter = { count: 0, resetAt: now + windowMs };
    counters.set(key, counter);
  }

  if (counter.count >= limit) return false;
  counter.count++;
  return true;
}

function giveBackAttempt(key: string) {
  const counter = counters.get(key);
  if (counter && counter.count > 0) counter.count--;
}

/**
 * The address the request came from.
 *
 * X-Forwarded-For is a header the client can set, so it is only believed when
 * TRUST_PROXY=true, which should be set only when exactly one proxy that we
 * control sits in front of the app and appends the address it saw. That proxy
 * adds its entry last, so the last entry is the one to use: anything the client
 * wrote is before it. Without a proxy the socket address is used, and a client
 * cannot change that.
 */
export function clientAddress(): string {
  if (process.env.TRUST_PROXY === "true") {
    const last = getRequestHeader("x-forwarded-for")?.split(",").at(-1)?.trim();
    if (last) return last;
  }
  return getRequestIP() ?? "unknown";
}

/** The counters are per address and email, so someone elsewhere cannot lock a user out. */
export function takeSignInAttempt(ip: string, email: string): boolean {
  const emailKey = `sign-in:${ip}:${email}`;
  if (!takeAttempt(emailKey, maxPerEmailAndIp)) return false;
  if (!takeAttempt(`ip:${ip}`, maxPerIp)) {
    giveBackAttempt(emailKey);
    return false;
  }
  return true;
}

export function giveBackSignInAttempt(ip: string, email: string) {
  giveBackAttempt(`sign-in:${ip}:${email}`);
  giveBackAttempt(`ip:${ip}`);
}

/**
 * Sign-up shares the per-address limit. Attempts that work are given back, so what
 * stays counted is the failures, such as probing for emails that are taken.
 */
export function takeSignUpAttempt(ip: string): boolean {
  return takeAttempt(`ip:${ip}`, maxPerIp);
}

export function giveBackSignUpAttempt(ip: string) {
  giveBackAttempt(`ip:${ip}`);
}
