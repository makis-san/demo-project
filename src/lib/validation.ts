import { z } from "zod";

/** A weight in the unit the app uses. Matches the decimal(6,2) database column. */
export const weightSchema = z
  .number()
  .min(0)
  .max(9999.99)
  .refine((value) => Math.round(value * 100) / 100 === value, "Use at most 2 decimal places");

/** A whole number of reps, at least 1. */
export const repsSchema = z.int().min(1).max(1000);

/** A body weight: same range and precision as a set weight, but not zero. */
export const bodyWeightSchema = weightSchema.refine((value) => value > 0, "Must be more than 0");

/**
 * When a body weight was recorded, when it is edited. Not in the future, because a weigh-in has already happened
 * (a few minutes of slack cover a browser clock that runs fast), and not before 2000, which only a typo gives.
 */
export const recordedAtSchema = z.coerce
  .date()
  .refine((value) => value.getTime() >= Date.UTC(2000, 0, 1), "That date is too far back")
  .refine((value) => value.getTime() <= Date.now() + 5 * 60_000, "The date can't be in the future");

/**
 * An email address as it is stored: trimmed and lowercase. Sign-up and sign-in
 * both use it, so `Foo@x.com` and `foo@x.com` are the same account. The length
 * limit is the longest address email allows, and it keeps a huge string from
 * being used as a lookup key.
 */
export const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email());

/**
 * The shortest password that can be set. NIST SP 800-63B asks for 8 and advises against rules like "needs a digit",
 * which push people to predictable passwords. It is checked only when a password is set (sign-up and password change),
 * so an account made under an older rule still signs in. The longest is a limit on work: hashing is slow on purpose.
 */
export const minPasswordLength = 8;
export const passwordSchema = z.string().min(minPasswordLength).max(128);
