import { z } from "zod";

/** A weight in the unit the app uses. Matches the decimal(6,2) database column. */
export const weightSchema = z
  .number()
  .min(0)
  .max(9999.99)
  .refine((value) => Math.round(value * 100) / 100 === value, "Use at most 2 decimal places");

/** A whole number of reps, at least 1. */
export const repsSchema = z.int().min(1).max(1000);
