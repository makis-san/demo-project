import { test, expect, gotoApp, waitForHydration } from "./fixtures";
import { getDb } from "./db";
import { completeWorkout, goTo } from "./helpers";

async function chartTitles(page: import("@playwright/test").Page) {
  return page
    .getByRole("img", { name: /over time$/ })
    .locator("circle title")
    .allTextContents();
}

test.describe("Progression chart", () => {
  // The late-workout test below expects Recife dates, so do not depend on the timezone of the machine running it.
  test.use({ timezoneId: "America/Recife" });

  test("should plot max weight per day and the totals per workout, for the chosen movement", async ({ page }) => {
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

    // Both workouts are from today. Max weight is "on a given day", so it is one point, the heaviest of the day.
    await metric.selectOption({ label: "Max weight" });
    await expect(page.getByRole("img", { name: "Max weight for Bench Press over time" })).toBeVisible();
    expect(await chartTitles(page)).toEqual([expect.stringMatching(/^105 lbs on [^,]+, \d{4}$/)]);

    // The totals are "in a workout", so each workout is a point, oldest first, and the time of day tells them apart.
    await metric.selectOption({ label: "Total reps" });
    // 5 + 5 + 3, then 8
    await expect(page.getByRole("img", { name: "Total reps for Bench Press over time" })).toBeVisible();
    expect(await chartTitles(page)).toEqual([
      expect.stringMatching(/^13 reps on [^,]+, \d{4} at \d\d:\d\d$/),
      expect.stringMatching(/^8 reps on [^,]+, \d{4} at \d\d:\d\d$/),
    ]);

    await metric.selectOption({ label: "Total volume" });
    // 100x5 + 100x5 + 105x3 = 1,315, then 62.5x8 = 500, and the squat is not counted
    await expect(page.getByRole("img", { name: "Total volume for Bench Press over time" })).toBeVisible();
    expect(await chartTitles(page)).toEqual([
      expect.stringMatching(/^1,315 lbs on [^,]+, \d{4} at \d\d:\d\d$/),
      expect.stringMatching(/^500 lbs on [^,]+, \d{4} at \d\d:\d\d$/),
    ]);
  });

  test("should not show the previous movement's points while the next movement loads", async ({ page }) => {
    await completeWorkout(page, [
      { movement: "Back Squat", weight: 200, reps: 5 },
      { movement: "Bench Press", weight: 100, reps: 5 },
    ]);
    // A full load, not the sidebar: it starts with an empty query cache, so the bench press chart data is certainly
    // not cached and there is a loading state to look at. (The current workout page no longer fetches each
    // movement's chart data. It makes one request for the last-set and PR hints, under a different key.)
    await gotoApp(page, "/workout-history");
    // Movements are listed by name, so the squat chart is the first one shown.
    await expect(page.getByRole("img", { name: "Max weight for Back Squat over time" })).toBeVisible();
    expect(await chartTitles(page)).toEqual([expect.stringMatching(/^200 lbs on /)]);

    // Hold back the next movement's data, so the loading state lasts long enough to look at.
    await page.route("**/_serverFn/**", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await route.continue();
    });
    await page.getByLabel("Movement", { exact: true }).selectOption({ label: "Bench Press" });

    await expect(page.getByText("Loading...")).toBeVisible();
    // The squat chart must be gone, not sitting under the bench press name.
    await expect(page.getByRole("img", { name: /over time$/ })).toHaveCount(0);

    await expect(page.getByRole("img", { name: "Max weight for Bench Press over time" })).toBeVisible();
    expect(await chartTitles(page)).toEqual([expect.stringMatching(/^100 lbs on /)]);
  });

  test("should include a workout completed after the chart was first shown", async ({ page }) => {
    await completeWorkout(page, [{ movement: "Bench Press", weight: 100, reps: 5 }]);
    await goTo(page, "Workout History");
    await expect(page.getByRole("img", { name: "Max weight for Bench Press over time" })).toBeVisible();
    expect(await chartTitles(page)).toEqual([expect.stringMatching(/^100 lbs on /)]);

    // Both workouts are from today, so the point for today now takes the heavier weight.
    await completeWorkout(page, [{ movement: "Bench Press", weight: 110, reps: 5 }]);
    await goTo(page, "Workout History");

    await expect(page.getByRole("img", { name: /over time$/ }).locator("circle title")).toHaveText(/^110 lbs on /);
  });

  test("should plot one point per day, and put a late workout on the user's own day", async ({ page, user }) => {
    await completeWorkout(page, [{ movement: "Bench Press", weight: 100, reps: 5 }]);
    await completeWorkout(page, [{ movement: "Bench Press", weight: 110, reps: 5 }]);

    // 01:30 UTC on Nov 8 is still the evening of Nov 7 in Recife (UTC-3), the timezone set above.
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

  test("should give two workouts on one day one max weight point and two points for each total", async ({
    page,
    user,
  }) => {
    // Three workouts: one alone on Nov 1, and two on Nov 7 in Recife. The two are on different days in UTC, because
    // 01:30 UTC on Nov 8 is 22:30 on Nov 7 in Recife (UTC-3), so the day has to come from the user's timezone.
    const times = ["2026-11-01T15:00:00Z", "2026-11-07T12:00:00Z", "2026-11-08T01:30:00Z"];
    const sets = [
      [{ movement: "Bench Press", weight: 100, reps: 5 }],
      [{ movement: "Bench Press", weight: 90, reps: 8 }],
      [
        { movement: "Bench Press", weight: 110, reps: 4 },
        { movement: "Bench Press", weight: 105, reps: 3 },
      ],
    ];
    for (const set of sets) await completeWorkout(page, set);
    const workouts = await getDb().workout.findMany({
      where: { user: { email: user.email } },
      orderBy: { completedAt: "asc" },
    });
    for (const [index, workout] of workouts.entries()) {
      const at = new Date(times[index]);
      await getDb().workout.update({ where: { id: workout.id }, data: { startedAt: at, completedAt: at } });
    }

    await goTo(page, "Workout History");
    await page.reload();
    // Without this, the selects can be changed before React takes over the page, and the change is lost.
    await waitForHydration(page);
    await page.getByLabel("Movement", { exact: true }).selectOption({ label: "Bench Press" });
    const metric = page.getByLabel("Metric");

    // The heaviest weight of Nov 7 is 110, from the later workout, and Nov 7 is one point.
    await metric.selectOption({ label: "Max weight" });
    await expect.poll(async () => (await chartTitles(page)).length).toBe(2);
    expect(await chartTitles(page)).toEqual(["100 lbs on Nov 1, 2026", "110 lbs on Nov 7, 2026"]);

    // Each total is a point per workout. The workout that is alone on its day has no time of day in its tooltip,
    // as before. The two on Nov 7 have it, so they can be told apart, and it is the time in Recife.
    await metric.selectOption({ label: "Total reps" });
    await expect.poll(async () => (await chartTitles(page)).length).toBe(3);
    expect(await chartTitles(page)).toEqual([
      "5 reps on Nov 1, 2026",
      "8 reps on Nov 7, 2026 at 09:00",
      "7 reps on Nov 7, 2026 at 22:30",
    ]);

    await metric.selectOption({ label: "Total volume" });
    await expect.poll(async () => (await chartTitles(page)).length).toBe(3);
    // 90x8 = 720 and 110x4 + 105x3 = 755
    expect(await chartTitles(page)).toEqual([
      "500 lbs on Nov 1, 2026",
      "720 lbs on Nov 7, 2026 at 09:00",
      "755 lbs on Nov 7, 2026 at 22:30",
    ]);

    // The two points of Nov 7 are drawn apart, not on top of each other.
    const circles = page.getByRole("img", { name: /over time$/ }).locator("circle");
    const [, first, second] = await circles.evaluateAll((all) => all.map((c) => Number(c.getAttribute("cx"))));
    expect(second - first).toBeGreaterThan(8);
  });
});

test.describe("Progression chart in another timezone", () => {
  test.use({ timezoneId: "Pacific/Kiritimati" });

  test("should use the browser's timezone for the day", async ({ page, user }) => {
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
