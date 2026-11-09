import { test, expect } from "./fixtures";
import { seedCompletedWorkouts } from "./db";
import { createWorkout, goTo, logBodyWeight, startWorkout, weekdayNamesFrom, pressStart } from "./helpers";

const zone = "America/Recife";
const [today, tomorrow] = weekdayNamesFrom(zone, 2);
/** The lit days in a workout's card in the library: the letters that are planned. */
const plannedDays = (page: import("@playwright/test").Page, name: string) =>
  page.locator(`[data-workout="${name}"]`).locator('[data-planned="true"]');
const weekOrder = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

test.describe("Home and the workout of the day", () => {
  test.use({ timezoneId: zone });

  test("should land on the home screen after signing in", async ({ page }) => {
    await expect(page).toHaveURL(/\/home/);
    await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Home", exact: true })).toHaveAttribute("aria-current", "page");
  });

  test("should greet the user and put starting a workout first when nothing is planned", async ({ page, user }) => {
    await expect(
      page.getByText(new RegExp(`^(Morning|Afternoon|Evening|Hey), ${user.name.split(" ")[0]}$`)),
    ).toBeVisible();
    // Nothing is planned and nothing was done before, so there is a Start and no repeat.
    await expect(page.getByRole("region", { name: "Workout of the day" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /^Repeat last/ })).toHaveCount(0);
    await page.getByRole("link", { name: "Start a workout" }).click();
    await expect(page).toHaveURL(/\/start-workout/);
    await expect(page.getByRole("button", { name: "Start workout" })).toBeVisible();
  });

  test("should offer to repeat the last workout, by the name of its workout or its date", async ({ page, user }) => {
    await seedCompletedWorkouts(user.email, [
      { completedAt: new Date(Date.now() - 60_000), sets: [{ movement: "Bench Press", weight: 100, reps: 5 }] },
    ]);
    await page.goto("/home");
    const repeat = page.getByRole("link", { name: /^Repeat last: / });
    await expect(repeat).toBeVisible();
    await repeat.click();
    await expect(page).toHaveURL(/\/start-workout\?.*from=/);
    await expect(page.getByRole("button", { name: "Start workout" })).toBeVisible();
    await expect(page.locator('[data-movement="Bench Press"]')).toBeVisible();
  });

  test("should show the workouts planned for today, and only those", async ({ page }) => {
    await createWorkout(page, "Push day", ["Bench Press"], [today]);
    await createWorkout(page, "Leg day", ["Back Squat"], [tomorrow]);
    await goTo(page, "Home");

    const section = page.getByRole("region", { name: "Workout of the day" });
    await expect(section.getByText("Push day", { exact: true })).toBeVisible();
    await expect(section.getByText("Leg day")).toHaveCount(0);
    // The library says which days each one is planned for, as seven letters with the planned ones lit.
    await goTo(page, "Workout Library");
    await expect(plannedDays(page, "Push day")).toHaveAttribute("aria-label", `${today}, planned`);
    await expect(plannedDays(page, "Leg day")).toHaveAttribute("aria-label", `${tomorrow}, planned`);
  });

  test("should plan more than one workout, and more than one day, for the same day", async ({ page }) => {
    await createWorkout(page, "Push day", ["Bench Press"], [today, tomorrow]);
    await createWorkout(page, "Abs", ["Crunch"], [today]);
    await goTo(page, "Home");

    const section = page.getByRole("region", { name: "Workout of the day" });
    await expect(section.getByRole("listitem")).toHaveCount(2);
    await expect(section.getByText("Abs", { exact: true })).toBeVisible();
    await expect(section.getByText("Push day", { exact: true })).toBeVisible();
    await goTo(page, "Workout Library");
    // Lit in the order of the week.
    const lit = [today, tomorrow].sort((a, b) => weekOrder.indexOf(a) - weekOrder.indexOf(b));
    await expect(plannedDays(page, "Push day")).toHaveCount(2);
    for (const [i, day] of lit.entries()) {
      await expect(plannedDays(page, "Push day").nth(i)).toHaveAttribute("aria-label", `${day}, planned`);
    }
  });

  test("should change the days of a workout, and drop it from the home screen", async ({ page }) => {
    await createWorkout(page, "Push day", ["Bench Press"], [today]);
    await page.getByRole("link", { name: "Edit Push day" }).click();
    await expect(page.getByRole("button", { name: today, exact: true })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: today, exact: true }).click();
    await page.getByRole("button", { name: tomorrow, exact: true }).click();
    await page.getByRole("button", { name: "Save workout" }).click();

    await goTo(page, "Home");
    await expect(page.getByRole("region", { name: "Workout of the day" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Start a workout" })).toBeVisible();
  });

  test("should start a workout of the day from the home screen, and mark it done once completed", async ({ page }) => {
    await createWorkout(page, "Push day", ["Bench Press"], [today]);
    await goTo(page, "Home");
    await page.getByRole("link", { name: "Start Push day" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Push day" })).toBeVisible();
    await pressStart(page);
    await page.getByRole("button", { name: "Log planned Bench Press set: 10 × no weight" }).first().click();
    await page.getByRole("button", { name: "Finish Workout" }).click();
    await expect(page.getByText("No active workout. Ready to start?")).toBeVisible();

    await goTo(page, "Home");
    const card = page.locator('[data-workout="Push day"]');
    await expect(card).toContainText("Done today");
    await expect(card.getByRole("link", { name: "Start Push day" })).toHaveText("Again");
  });

  test("should show the workout of the day on the current workout page when none is active", async ({ page }) => {
    await createWorkout(page, "Push day", ["Bench Press"], [today]);
    await goTo(page, "Current Workout");

    await expect(page.getByRole("region", { name: "Workout of the day" }).getByText("Push day")).toBeVisible();
  });

  test("should show the workout in progress and let the user continue it", async ({ page }) => {
    await startWorkout(page);
    await goTo(page, "Home");

    await expect(page.getByText("In progress", { exact: true })).toBeVisible();
    // The clock of the workout runs on the home screen too.
    await expect(page.getByRole("region", { name: "Workout in progress" })).toContainText(/\d+:\d{2}/);
    await page.getByRole("link", { name: "Resume workout" }).click();
    await expect(page.getByRole("button", { name: "Finish Workout" })).toBeVisible();
  });

  test("should show the week as seven days with the days trained lit, and its numbers in a line", async ({
    page,
    user,
  }) => {
    await seedCompletedWorkouts(user.email, [
      {
        completedAt: new Date(Date.now() - 1000 * 60),
        sets: [
          { movement: "Bench Press", weight: 100, reps: 5 },
          { movement: "Bench Press", weight: 100, reps: 5 },
        ],
      },
    ]);
    await page.goto("/home");

    const week = page.getByLabel("This week");
    await expect(week.getByRole("listitem")).toHaveCount(7);
    // Today was trained, and is marked as today.
    await expect(week.locator('[data-trained="true"]')).toHaveAttribute("aria-label", /, 1 workout, today$/);
    await expect(week).toContainText("1 workout · 2 sets · 1,000 lbs");
    // The calendar of 18 weeks lives on the history page.
    await expect(page.getByRole("heading", { name: "Training calendar" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /Log your body weight/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /^Last session/ })).toContainText("2 sets");
  });

  test("should show the latest body weight in a line that opens the body weight page", async ({ page }) => {
    await logBodyWeight(page, 181.4);
    await goTo(page, "Home");
    await page.getByRole("link", { name: /181.4 lbs/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Body Weight" })).toBeVisible();
  });
});

test.describe("Workout of the day, in the user's own day", () => {
  // Pacific/Kiritimati is 14 hours ahead of UTC and Etc/GMT+12 is 12 behind, so for part of every day the two are on
  // different dates. Each must see the workout planned for its own today.
  for (const timeZone of ["Pacific/Kiritimati", "Etc/GMT+12"]) {
    test.describe(timeZone, () => {
      test.use({ timezoneId: timeZone });

      test("should plan for the weekday of the user's own today", async ({ page }) => {
        const [own, other] = weekdayNamesFrom(timeZone, 2);
        await createWorkout(page, "Own day", ["Bench Press"], [own]);
        await createWorkout(page, "Next day", ["Back Squat"], [other]);
        await goTo(page, "Home");

        const section = page.getByRole("region", { name: "Workout of the day" });
        await expect(section.getByText("Own day", { exact: true })).toBeVisible();
        await expect(section.getByText("Next day")).toHaveCount(0);
      });
    });
  }
});
