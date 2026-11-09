import { z } from "zod";

/**
 * The 14 muscle groups Setlist tracks. They are the values of the `MuscleGroup` enum in the database, so the
 * names here and in prisma/schema.prisma must stay the same. The list is short and fixed, which is why a
 * movement stores its muscles as an enum array and not through a join table.
 */
export const muscleGroups = [
  "chest",
  "shoulders",
  "traps",
  "lats",
  "lower_back",
  "biceps",
  "triceps",
  "forearms",
  "abs",
  "obliques",
  "glutes",
  "quads",
  "hamstrings",
  "calves",
] as const;

export type MuscleGroup = (typeof muscleGroups)[number];

export const muscleLabels: Record<MuscleGroup, string> = {
  chest: "Chest",
  shoulders: "Shoulders",
  traps: "Traps",
  lats: "Lats",
  lower_back: "Lower back",
  biceps: "Biceps",
  triceps: "Triceps",
  forearms: "Forearms",
  abs: "Abs",
  obliques: "Obliques",
  glutes: "Glutes",
  quads: "Quads",
  hamstrings: "Hamstrings",
  calves: "Calves",
};

/** What a movement is done with. The values of the `Equipment` enum in the database. */
export const equipmentTypes = ["barbell", "dumbbell", "kettlebell", "machine", "cable", "bodyweight", "other"] as const;

export type Equipment = (typeof equipmentTypes)[number];

export const equipmentLabels: Record<Equipment, string> = {
  barbell: "Barbell",
  dumbbell: "Dumbbell",
  kettlebell: "Kettlebell",
  machine: "Machine",
  cable: "Cable",
  bodyweight: "Body only",
  other: "Other",
};

export const muscleGroupSchema = z.enum(muscleGroups);
export const equipmentSchema = z.enum(equipmentTypes);

/** A list of muscle groups, each at most once. Optional: a custom movement may have none. */
export const muscleListSchema = z
  .array(muscleGroupSchema)
  .max(muscleGroups.length)
  .default([])
  .transform((list) => [...new Set(list)]);

/** A muscle cannot be both primary and secondary, so the two lists of a movement must not share one. */
export const musclesAreDisjoint = (value: { primaryMuscles: string[]; secondaryMuscles: string[] }) =>
  value.primaryMuscles.every((muscle) => !value.secondaryMuscles.includes(muscle));

/** Sets a movement gives to each muscle group: a primary muscle counts 1 set, a secondary one half. */
export const primarySetWeight = 1;
export const secondarySetWeight = 0.5;
