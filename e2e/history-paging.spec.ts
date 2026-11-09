import { randomUUID } from "node:crypto";
import { type Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { seedCompletedWorkouts, type SeedWorkout } from "./db";
import { completeWorkout, goTo } from "./helpers";

// One page of history is 20 workouts.
const pageSize = 20;
const day = 24 * 60 * 60 * 1000;

const rows = (page: Page) =>
  page.getByRole("row").filter({ has: page.getByRole("checkbox", { name: "Select workout" }) });
const loadMore = (page: Page) => page.getByRole("button", { name: "Load more" });

/** The number of sets in every row, in the order shown. Each seeded workout has its own count, so it tells the rows apart. */
async function setCounts(page: Page) {
  return (await rows(page).locator("td:nth-child(3)").allTextContents()).map(Number);
}

/** Workouts with 1, 2, ... sets, the first one the newest, a day apart. The set count is the way to tell them apart. */
function workoutsNewestFirst(count: number, firstSetCount = 1): SeedWorkout[] {
  return Array.from({ length: count }, (_, i) => ({
    completedAt: new Date(Date.now() - (i + 1) * day),
    sets: Array.from({ length: firstSetCount + i }, () => ({ movement: "Bench Press", weight: 100, reps: 5 })),
  }));
}

const oneTo = (n: number, from = 1) => Array.from({ length: n }, (_, i) => from + i);

test.describe("Workout history paging", () => {
  test("should show the newest page first and load the older ones on demand", async ({ page, user }) => {
    await seedCompletedWorkouts(user.email, workoutsNewestFirst(45));

    await goTo(page, "Workout History");
    await expect(rows(page)).toHaveCount(pageSize);
    expect(await setCounts(page)).toEqual(oneTo(20));

    await loadMore(page).click();
    await expect(rows(page)).toHaveCount(40);
    expect(await setCounts(page)).toEqual(oneTo(40));

    await loadMore(page).click();
    await expect(rows(page)).toHaveCount(45);
    expect(await setCounts(page)).toEqual(oneTo(45));
    await expect(loadMore(page)).toHaveCount(0);
  });

  test("should not show Load more when everything fits on one page", async ({ page, user }) => {
    await seedCompletedWorkouts(user.email, workoutsNewestFirst(pageSize));

    await goTo(page, "Workout History");

    await expect(rows(page)).toHaveCount(pageSize);
    await expect(loadMore(page)).toHaveCount(0);
  });

  test("should list workouts with the same completion time once each, across the page edge", async ({ page, user }) => {
    // Four workouts completed at the same moment sit on both sides of the end of page one. Their ids decide the order.
    const runId = randomUUID();
    const seeded = workoutsNewestFirst(45);
    const tied = seeded[18].completedAt;
    const workouts = seeded.map((w, i) =>
      i >= 18 && i <= 21 ? { ...w, completedAt: tied, id: `${runId}-tied-${i}` } : w,
    );
    await seedCompletedWorkouts(user.email, workouts);

    // The order is completedAt, then id, both newest first, so the tied ones come out in reverse id order.
    const expected = oneTo(45);
    expected.splice(18, 4, 22, 21, 20, 19);

    await goTo(page, "Workout History");
    await expect(rows(page)).toHaveCount(pageSize);
    await loadMore(page).click();
    await expect(rows(page)).toHaveCount(40);
    await loadMore(page).click();
    await expect(rows(page)).toHaveCount(45);

    expect(await setCounts(page)).toEqual(expected);
  });

  test("should not repeat or skip a workout when one is completed after the first page was shown", async ({
    page,
    user,
  }) => {
    await seedCompletedWorkouts(user.email, workoutsNewestFirst(45));
    await goTo(page, "Workout History");
    await expect(rows(page)).toHaveCount(pageSize);

    // A newer workout appears. With "skip 20 rows" the next page would start with a workout already shown.
    await seedCompletedWorkouts(user.email, [
      {
        completedAt: new Date(),
        sets: Array.from({ length: 50 }, () => ({ movement: "Bench Press", weight: 100, reps: 5 })),
      },
    ]);
    await loadMore(page).click();

    await expect(rows(page)).toHaveCount(40);
    expect(await setCounts(page)).toEqual(oneTo(40));
  });

  test("should show every movement as a column and in the chart list, whatever page is loaded", async ({
    page,
    user,
  }) => {
    // Only the oldest workout, on the second page, has a Deadlift.
    const workouts = workoutsNewestFirst(25);
    workouts[24].sets!.push({ movement: "Deadlift", weight: 200, reps: 3 });
    await seedCompletedWorkouts(user.email, workouts);

    await goTo(page, "Workout History");
    await expect(rows(page)).toHaveCount(pageSize);

    // The column is there and empty for the rows shown, and the chart can already pick it.
    await expect(page.getByRole("columnheader", { name: "Deadlift" })).toBeVisible();
    await expect(rows(page).last().getByRole("cell").last()).toHaveText("-");
    await expect(page.getByLabel("Movement", { exact: true }).getByRole("option", { name: "Deadlift" })).toHaveCount(1);

    await loadMore(page).click();
    await expect(rows(page)).toHaveCount(25);
    await expect(rows(page).last().getByRole("cell").last()).toHaveText("200 lbs / 3 reps / 1 sets");
  });

  test("should draw the chart from all workouts, not only the page shown", async ({ page, user }) => {
    // 30 workouts on 30 different days, so 30 points, while the table shows 20 rows.
    await seedCompletedWorkouts(
      user.email,
      Array.from({ length: 30 }, (_, i) => ({
        completedAt: new Date(Date.now() - (i + 1) * day),
        sets: [{ movement: "Bench Press", weight: 100 + i, reps: 5 }],
      })),
    );

    await goTo(page, "Workout History");

    await expect(rows(page)).toHaveCount(pageSize);
    const chart = page.getByRole("img", { name: "Max weight for Bench Press over time" });
    await expect(chart.locator("circle")).toHaveCount(30);
  });

  test("should show a workout completed now at the top, with older pages already loaded", async ({ page, user }) => {
    // The movement is added in the page, which a movement made in the database behind its back would not be.
    // 2 to 26 sets, so the workout completed below, with 1 set, is told apart.
    await seedCompletedWorkouts(user.email, workoutsNewestFirst(25, 2));
    await goTo(page, "Workout History");
    await loadMore(page).click();
    await expect(rows(page)).toHaveCount(25);

    await goTo(page, "Current Workout");
    await completeWorkout(page, [{ movement: "Bench Press", weight: 100, reps: 5 }]);
    await goTo(page, "Workout History");

    // Both pages are fetched again, and every workout is there once.
    await expect(rows(page)).toHaveCount(26);
    expect(await setCounts(page)).toEqual(oneTo(26));
  });

  test("should delete workouts from a loaded second page", async ({ page, user }) => {
    await seedCompletedWorkouts(user.email, workoutsNewestFirst(25));
    await goTo(page, "Workout History");
    await loadMore(page).click();
    await expect(rows(page)).toHaveCount(25);

    // The workouts with 1 set (first row) and 25 sets (last row, from the second page).
    await rows(page).first().getByRole("checkbox").check();
    await rows(page).last().getByRole("checkbox").check();
    await page.getByRole("button", { name: "Delete Selected (2)" }).click();

    await expect(rows(page)).toHaveCount(23);
    expect(await setCounts(page)).toEqual(oneTo(24).slice(1));
    await expect(loadMore(page)).toHaveCount(0);
  });
});
