import { z } from "zod";

/** The rest between series when nothing else is said: a minute. */
export const defaultRestSeconds = 60;
export const maxExercisesPerPreset = 30;
export const maxSetsPerExercise = 20;

/** Seconds, whole, up to an hour. Zero means no rest timer for that movement. */
export const restSecondsSchema = z.int().min(0).max(3600);
