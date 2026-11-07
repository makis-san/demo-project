import { test, expect } from "./fixtures";
import { getDb } from "./db";
import { addMovement, completeWorkout, goTo } from "./helpers";

async function chartTitles(page: import("@playwright/test").Page) {
  return page
    .getByRole("img", { name: /over time$/ })
    .locator("circle title")
    .allTextContents();
}

test.describe("Progression chart", () => {
  test("should plot each metric for the chosen movement, with two workouts on one day as one point", async ({
    page,
  }) => {
    await addMovement(page, "Bench Press");
    await addMovement(page, "Back Squat");
    await completeWorkout(page, [
      { movement: "Bench Press", weight: 100, reps: 5 },
      { movement: "Bench Press", weight: 100, reps: 5 },
      { movement: "Bench Press", weight: 105, reps: 3 },
      { movement: "Back Squat", weight: 200, reps: 5 },
    ]);
    await completeWorkout(page, [{ movement: "Bench Press", weight: 62.5, reps: 8 }]);

    await goTo(page, "Workout History");
    await page.getByLabel("Movement", { exact: true }).selectOption({ label: "Bench Press" });
    const metric = page.getByLabel("Metric");

    // Both workouts are from today, so each metric is a single point, summed or maximised over the day.
    await metric.selectOption({ label: "Max weight" });
    await expect(page.getByRole("img", { name: "Max weight for Bench Press over time" })).toBeVisible();
    expect(await chartTitles(page)).toEqual([expect.stringMatching(/^105 lbs on /)]);

    await metric.selectOption({ label: "Total reps" });
    // 5 + 5 + 3 + 8
    await expect(page.getByRole("img", { name: "Total reps for Bench Press over time" })).toBeVisible();
    expect(await chartTitles(page)).toEqual([expect.stringMatching(/^21 reps on /)]);

    await metric.selectOption({ label: "Total volume" });
    // 100x5 + 100x5 + 105x3 + 62.5x8 = 500 + 500 + 315 + 500, and the squat is not counted
    await expect(page.getByRole("img", { name: "Total volume for Bench Press over time" })).toBeVisible();
    expect(await chartTitles(page)).toEqual([expect.stringMatching(/^1,815 lbs on /)]);
  });

  test("should plot one point per day, and put a late workout on the user's own day", async ({ page, user }) => {
    await addMovement(page, "Bench Press");
    await completeWorkout(page, [{ movement: "Bench Press", weight: 100, reps: 5 }]);
    await completeWorkout(page, [{ movement: "Bench Press", weight: 110, reps: 5 }]);

    // 01:30 UTC on Nov 8 is still the evening of Nov 7 in Recife (UTC-3), where this test runs.
    // Give the two workouts fixed times a week apart, and compare with the same dates in UTC.
    const workouts = await getDb().workout.findMany({
      where: { user: { email: user.email } },
      orderBy: { completedAt: "asc" },
    });
    const times = ["2026-11-01T15:00:00Z", "2026-11-08T01:30:00Z"].map((value) => new Date(value));
    for (const [index, workout] of workouts.entries()) {
      await getDb().workout.update({
        where: { id: workout.id },
        data: { startedAt: times[index], completedAt: times[index] },
      });
    }

    await goTo(page, "Workout History");
    await page.reload();
    await page.getByLabel("Movement", { exact: true }).selectOption({ label: "Bench Press" });
    await page.getByLabel("Metric").selectOption({ label: "Max weight" });

    // Two days, and the second is Nov 7, not Nov 8.
    await expect.poll(async () => (await chartTitles(page)).length).toBe(2);
    expect(await chartTitles(page)).toEqual(["100 lbs on Nov 1, 2026", "110 lbs on Nov 7, 2026"]);
  });
});

test.describe("Progression chart in another timezone", () => {
  test.use({ timezoneId: "Pacific/Kiritimati" });

  test("should use the browser's timezone for the day", async ({ page, user }) => {
    await addMovement(page, "Bench Press");
    await completeWorkout(page, [{ movement: "Bench Press", weight: 100, reps: 5 }]);
    const workout = await getDb().workout.findFirstOrThrow({ where: { user: { email: user.email } } });
    // 20:00 UTC on Nov 7 is already Nov 8 at UTC+14.
    const at = new Date("2026-11-07T20:00:00Z");
    await getDb().workout.update({ where: { id: workout.id }, data: { startedAt: at, completedAt: at } });

    await goTo(page, "Workout History");
    await page.reload();

    await expect(page.getByRole("img", { name: /over time$/ }).locator("circle title")).toHaveText(
      "100 lbs on Nov 8, 2026",
    );
    await expect(page.getByRole("cell", { name: "Nov 8, 2026" })).toBeVisible();
  });
});
