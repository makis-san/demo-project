import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { test, expect } from "./fixtures";
import { breakWrites, getDb } from "./db";
import { deleteUserAndData } from "../src/lib/account.server";

/**
 * A user with a bit of everything: two sessions, a completed workout and an active one, sets on a built-in and on
 * their own movement, a workout repeated from the first, body weights, and a preset that holds their own movement,
 * with a series and a weekday. The preset started one of the workouts.
 */
async function createUserWithData(label: string) {
  const db = getDb();
  const user = await db.user.create({
    data: { email: `e2e-${label}-${randomUUID().slice(0, 8)}@example.com`, passwordHash: "not-a-real-hash" },
  });
  const builtIn = await db.movement.findFirstOrThrow({ where: { userId: null, name: "Bench Press" } });
  const custom = await db.movement.create({ data: { userId: user.id, name: `Own lift ${randomUUID().slice(0, 8)}` } });

  await db.session.createMany({
    data: [1, 2].map((n) => ({
      userId: user.id,
      tokenHash: randomUUID(),
      expiresAt: new Date(Date.now() + n * 3600_000),
    })),
  });
  await db.bodyWeight.createMany({
    data: [180, 181].map((weight, i) => ({
      userId: user.id,
      weight,
      recordedAt: new Date(Date.now() - i * 86400_000),
    })),
  });
  const preset = await db.workoutPreset.create({
    data: {
      userId: user.id,
      name: "Push day",
      days: { create: [{ weekday: 1 }] },
      exercises: {
        create: [{ movementId: custom.id, position: 0, sets: { create: [{ position: 0, reps: 5, weight: 50 }] } }],
      },
    },
  });
  const completed = await db.workout.create({
    data: {
      userId: user.id,
      presetId: preset.id,
      completedAt: new Date(),
      sets: {
        create: [
          { movementId: builtIn.id, reps: 5, weight: 100 },
          { movementId: custom.id, reps: 8, weight: 50 },
        ],
      },
    },
  });
  await db.workout.create({
    data: {
      userId: user.id,
      sourceWorkoutId: completed.id,
      sets: { create: [{ movementId: custom.id, reps: 5, weight: 55 }] },
    },
  });
  return { user, customId: custom.id, builtInId: builtIn.id };
}

/** Every row that belongs to a user, found by id so it also works for tables that have no `userId`. */
async function rowsOf(userId: string) {
  const db = getDb();
  const [workouts, presets, movements] = await Promise.all([
    db.workout.findMany({ where: { userId }, select: { id: true } }),
    db.workoutPreset.findMany({ where: { userId }, select: { id: true } }),
    db.movement.findMany({ where: { userId }, select: { id: true } }),
  ]);
  const workoutIds = workouts.map((w) => w.id);
  const presetIds = presets.map((p) => p.id);
  const exercises = await db.presetExercise.findMany({ where: { presetId: { in: presetIds } }, select: { id: true } });
  return {
    user: await db.user.count({ where: { id: userId } }),
    sessions: await db.session.count({ where: { userId } }),
    workouts: workoutIds.length,
    sets: await db.set.count({ where: { workoutId: { in: workoutIds } } }),
    bodyWeights: await db.bodyWeight.count({ where: { userId } }),
    presets: presetIds.length,
    presetExercises: exercises.length,
    presetSets: await db.presetSet.count({ where: { exerciseId: { in: exercises.map((e) => e.id) } } }),
    presetDays: await db.presetDay.count({ where: { presetId: { in: presetIds } } }),
    movements: movements.length,
  };
}

/** Rows in every table that has a `userId` column, for one user. It follows the database, so a table added later is checked too. */
async function userIdRows(userId: string) {
  const db = getDb();
  const tables = await db.$queryRaw<{ table_name: string }[]>`
    SELECT table_name FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'userId'`;
  const counts: Record<string, number> = {};
  for (const { table_name } of tables) {
    const [{ n }] = await db.$queryRawUnsafe<{ n: number }[]>(
      `SELECT COUNT(*)::int AS n FROM "${table_name}" WHERE "userId" = $1`,
      userId,
    );
    counts[table_name] = n;
  }
  return counts;
}

test.describe("Deleting a user", () => {
  test("should remove the user and everything of theirs, and leave other users alone", async () => {
    const mine = await createUserWithData("delete-me");
    const other = await createUserWithData("keep-me");
    const before = await rowsOf(mine.user.id);
    // The setup really made a bit of everything, or "nothing left" would prove little.
    expect(before).toEqual({
      user: 1,
      sessions: 2,
      workouts: 2,
      sets: 3,
      bodyWeights: 2,
      presets: 1,
      presetExercises: 1,
      presetSets: 1,
      presetDays: 1,
      movements: 1,
    });
    const otherBefore = await rowsOf(other.user.id);

    const counts = await deleteUserAndData(getDb(), mine.user.id);

    expect(counts).toEqual({ sessions: 2, workouts: 2, bodyWeights: 2, presets: 1, movements: 1 });
    expect(await rowsOf(mine.user.id)).toEqual({
      user: 0,
      sessions: 0,
      workouts: 0,
      sets: 0,
      bodyWeights: 0,
      presets: 0,
      presetExercises: 0,
      presetSets: 0,
      presetDays: 0,
      movements: 0,
    });
    expect(Object.values(await userIdRows(mine.user.id)).every((n) => n === 0)).toBe(true);
    // The other user's rows are the same, and the built-in movement is still there.
    expect(await rowsOf(other.user.id)).toEqual(otherBefore);
    expect(await getDb().movement.count({ where: { id: mine.builtInId, userId: null } })).toBe(1);
  });

  for (const failAt of [
    { table: "Workout", step: "after the workouts are deleted" },
    { table: "User", step: "at the last step, deleting the user" },
  ] as const) {
    test(`should keep everything when it fails ${failAt.step}`, async () => {
      const mine = await createUserWithData("rollback");
      const before = await rowsOf(mine.user.id);
      const beforeByUserId = await userIdRows(mine.user.id);
      const repair = await breakWrites(
        failAt.table,
        "AFTER DELETE",
        `OLD."${failAt.table === "User" ? "id" : "userId"}" = '${mine.user.id}'`,
      );
      try {
        await expect(deleteUserAndData(getDb(), mine.user.id)).rejects.toThrow();
      } finally {
        await repair();
      }

      // Not one row is gone, even the ones deleted before the failure.
      expect(await rowsOf(mine.user.id)).toEqual(before);
      expect(await userIdRows(mine.user.id)).toEqual(beforeByUserId);
      // And with the failure gone the same call works.
      await deleteUserAndData(getDb(), mine.user.id);
      expect((await rowsOf(mine.user.id)).user).toBe(0);
    });
  }

  test("should refuse a user that does not exist, and change nothing", async () => {
    const other = await createUserWithData("untouched");
    const before = await rowsOf(other.user.id);

    await expect(deleteUserAndData(getDb(), randomUUID())).rejects.toThrow();

    expect(await rowsOf(other.user.id)).toEqual(before);
  });

  test.describe("bun run user:delete", () => {
    const run = (...args: string[]) =>
      execFileSync("bun", ["scripts/delete-user.ts", ...args], {
        encoding: "utf8",
        stdio: "pipe",
        env: { ...process.env, DATABASE_URL: "" },
      });

    test("should delete the user it is given on the database it is told", async () => {
      const mine = await createUserWithData("script");

      const output = run(mine.user.email.toUpperCase(), "--url", process.env.DATABASE_URL!);

      expect(output).toContain(
        `Deleted ${mine.user.email}. Rows removed: sessions 2, workouts 2, bodyWeights 2, presets 1, movements 1.`,
      );
      expect((await rowsOf(mine.user.id)).user).toBe(0);
    });

    test("should refuse to run without a database URL, even when the environment has one", async () => {
      const mine = await createUserWithData("script-no-url");

      expect(() => run(mine.user.email)).toThrow(/Usage: bun run user:delete/);
      // The environment's own DATABASE_URL is not used as a fallback.
      expect(() => execFileSync("bun", ["scripts/delete-user.ts", mine.user.email], { stdio: "pipe" })).toThrow(
        /Usage/,
      );
      expect((await rowsOf(mine.user.id)).user).toBe(1);
    });

    test("should say so when the email is not in the database", async () => {
      expect(() => run("nobody-here@example.com", "--url", process.env.DATABASE_URL!)).toThrow(
        /No user with the email/,
      );
    });
  });
});
