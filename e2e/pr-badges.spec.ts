import { type Page, type Request } from "@playwright/test";
import { test, expect } from "./fixtures";
import { seedCompletedWorkouts } from "./db";
import { addSet, goTo, selectMovement, setRows, startWorkout } from "./helpers";

const day = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(Date.now() - n * day);

const historyRows = (page: Page) =>
  page.getByRole("row").filter({ has: page.getByRole("checkbox", { name: "Select workout" }) });
const pr = (page: Page) => page.getByText("PR", { exact: true });

/**
 * The name of the server function a request calls. In the dev server the path is `/_serverFn/` and the base64 of
 * `{"file": ..., "export": "<name>_createServerFn_handler"}`, so the name can be read back from it.
 */
function serverFnName(request: Request) {
  const id = new URL(request.url()).pathname.split("/_serverFn/")[1];
  if (!id) return null;
  try {
    return (JSON.parse(Buffer.from(id, "base64url").toString()) as { export?: string }).export ?? null;
  } catch {
    return null;
  }
}

test.describe("PR badges and the last top set", () => {
  test("should mark each set that beats the movement's best, and say what the last time was", async ({
    page,
    user,
  }) => {
    // Best ever 105. The newest day's top set is 90, so that is the "last" one.
    await seedCompletedWorkouts(user.email, [
      {
        completedAt: daysAgo(3),
        sets: [
          { movement: "Bench Press", weight: 100, reps: 5 },
          { movement: "Bench Press", weight: 105, reps: 3 },
        ],
      },
      { completedAt: daysAgo(1), sets: [{ movement: "Bench Press", weight: 90, reps: 5 }] },
    ]);
    await startWorkout(page);

    await selectMovement(page, "Bench Press");
    await expect(page.getByText(/^Last top set 90 lbs · .+ · Best 105$/)).toBeVisible();
    await selectMovement(page, "Back Squat");
    await expect(page.getByText("First time logging this one")).toBeVisible();

    // 100 does not beat 105. 110 does, and then 108 does not beat 110. 112.5 does.
    for (const weight of [100, 110, 108, 112.5]) await addSet(page, { movement: "Bench Press", weight, reps: 5 });
    await expect(setRows(page)).toHaveCount(4);
    await expect(setRows(page).nth(0).getByText("PR", { exact: true })).toHaveCount(0);
    await expect(setRows(page).nth(1).getByText("PR", { exact: true })).toHaveCount(1);
    await expect(setRows(page).nth(2).getByText("PR", { exact: true })).toHaveCount(0);
    await expect(setRows(page).nth(3).getByText("PR", { exact: true })).toHaveCount(1);

    // A movement that was never trained has nothing to beat, however heavy the set is.
    await addSet(page, { movement: "Back Squat", weight: 300, reps: 1 });
    await expect(setRows(page)).toHaveCount(5);
    await expect(pr(page)).toHaveCount(2);
  });

  test("should ask for the history of every movement in the workout in one request", async ({ page, user }) => {
    await seedCompletedWorkouts(user.email, [
      {
        completedAt: daysAgo(2),
        sets: [
          { movement: "Bench Press", weight: 100, reps: 5 },
          { movement: "Back Squat", weight: 140, reps: 5 },
          { movement: "Overhead Press", weight: 60, reps: 5 },
          { movement: "Deadlift", weight: 180, reps: 5 },
        ],
      },
    ]);
    await startWorkout(page);
    for (const [movement, weight] of [
      ["Bench Press", 105],
      ["Back Squat", 145],
      ["Overhead Press", 65],
      ["Deadlift", 185],
    ] as const) {
      await addSet(page, { movement, weight, reps: 5 });
    }

    // A full load of the page with four movements in the workout. This used to be one request per movement.
    const names: string[] = [];
    page.on("request", (request) => {
      const name = serverFnName(request);
      if (name) names.push(name);
    });
    await page.reload();
    await expect(pr(page)).toHaveCount(4);

    expect(names.filter((name) => name.startsWith("getMovementBestsServerFn"))).toHaveLength(1);
    expect(names.filter((name) => name.startsWith("getProgressionServerFn"))).toHaveLength(0);
  });

  test("should drop a PR badge when a set in a completed workout is edited to beat it", async ({ page, user }) => {
    await seedCompletedWorkouts(user.email, [
      { completedAt: daysAgo(2), sets: [{ movement: "Bench Press", weight: 100, reps: 5 }] },
    ]);
    await startWorkout(page);
    await addSet(page, { movement: "Bench Press", weight: 105, reps: 5 });
    await expect(pr(page)).toHaveCount(1);

    // Fix a typo in the old workout: it was 110. Going back with the sidebar keeps the page's cached data, so this only
    // works if editing the set refreshed the numbers the badges are made from.
    await goTo(page, "Workout History");
    await historyRows(page).getByRole("button", { name: "Show the sets of this workout" }).click();
    await page.getByRole("button", { name: "Edit Bench Press set: 5 × 100 lbs" }).click();
    await page.getByRole("spinbutton", { name: "Weight for Bench Press" }).fill("110");
    await page.getByRole("button", { name: "Save set" }).click();
    await expect(page.getByRole("button", { name: "Edit Bench Press set: 5 × 110 lbs" })).toBeVisible();

    await goTo(page, "Current Workout");
    await expect(setRows(page)).toHaveCount(1);
    await expect(pr(page)).toHaveCount(0);
  });

  test("should give a PR back when the workout that held the best is deleted", async ({ page, user }) => {
    // The older workout has the best, 120, and one set. The newer has two sets of 100.
    await seedCompletedWorkouts(user.email, [
      { completedAt: daysAgo(5), sets: [{ movement: "Bench Press", weight: 120, reps: 3 }] },
      {
        completedAt: daysAgo(2),
        sets: [
          { movement: "Bench Press", weight: 100, reps: 5 },
          { movement: "Bench Press", weight: 100, reps: 5 },
        ],
      },
    ]);
    await startWorkout(page);
    await addSet(page, { movement: "Bench Press", weight: 110, reps: 5 });
    await expect(setRows(page)).toHaveCount(1);
    await expect(pr(page)).toHaveCount(0);

    await goTo(page, "Workout History");
    await historyRows(page)
      .filter({ has: page.getByRole("cell", { name: "1", exact: true }) })
      .getByRole("checkbox")
      .check();
    await page.getByRole("button", { name: "Delete Selected (1)" }).click();
    await expect(historyRows(page)).toHaveCount(1);

    await goTo(page, "Current Workout");
    await expect(setRows(page)).toHaveCount(1);
    await expect(pr(page)).toHaveCount(1);
  });

  test("should give a PR back when a set in a completed workout is edited down", async ({ page, user }) => {
    // The mirror of editing up: the best was 130, a typo, and the real one is 100.
    await seedCompletedWorkouts(user.email, [
      { completedAt: daysAgo(2), sets: [{ movement: "Bench Press", weight: 130, reps: 5 }] },
    ]);
    await startWorkout(page);
    await addSet(page, { movement: "Bench Press", weight: 105, reps: 5 });
    await expect(setRows(page)).toHaveCount(1);
    await expect(pr(page)).toHaveCount(0);

    await goTo(page, "Workout History");
    await historyRows(page).getByRole("button", { name: "Show the sets of this workout" }).click();
    await page.getByRole("button", { name: "Edit Bench Press set: 5 × 130 lbs" }).click();
    await page.getByRole("spinbutton", { name: "Weight for Bench Press" }).fill("100");
    await page.getByRole("button", { name: "Save set" }).click();
    await expect(page.getByRole("button", { name: "Edit Bench Press set: 5 × 100 lbs" })).toBeVisible();

    await goTo(page, "Current Workout");
    await expect(pr(page)).toHaveCount(1);
  });
});
