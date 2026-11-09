import { test, expect } from "./fixtures";
import { seedCompletedWorkouts } from "./db";
import { createWorkout, goTo, startWorkout, weekdayNamesFrom, pressStart } from "./helpers";

const zone = "America/Recife";
const [today, tomorrow] = weekdayNamesFrom(zone, 2);
const weekOrder = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

test.describe("Home and the workout of the day", () => {
  test.use({ timezoneId: zone });

  test("should land on the home screen after signing in", async ({ page }) => {
    await expect(page).toHaveURL(/\/home/);
    await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Home", exact: true })).toHaveAttribute("aria-current", "page");
  });

  test("should say nothing is planned for today, and where to plan it", async ({ page }) => {
    await expect(page.getByText("Nothing planned for today.")).toBeVisible();
    await page.getByRole("link", { name: "Open your workouts" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Workout Library" })).toBeVisible();
  });

  test("should show the workouts planned for today, and only those", async ({ page }) => {
    await createWorkout(page, "Push day", ["Bench Press"], [today]);
    await createWorkout(page, "Leg day", ["Back Squat"], [tomorrow]);
    await goTo(page, "Home");

    const section = page.getByRole("region", { name: "Workout of the day" });
    await expect(section.getByText("Push day", { exact: true })).toBeVisible();
    await expect(section.getByText("Leg day")).toHaveCount(0);
    // The library says which days each one is planned for.
    await goTo(page, "Workout Library");
    await expect(page.locator('[data-workout="Push day"]').getByLabel("Workout of the day on")).toHaveText(
      today.slice(0, 3),
    );
    await expect(page.locator('[data-workout="Leg day"]').getByLabel("Workout of the day on")).toHaveText(
      tomorrow.slice(0, 3),
    );
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
    await expect(page.locator('[data-workout="Push day"]').getByLabel("Workout of the day on")).toHaveText(
      // Shown in the order of the week.
      [today, tomorrow]
        .sort((a, b) => weekOrder.indexOf(a) - weekOrder.indexOf(b))
        .map((d) => d.slice(0, 3))
        .join(", "),
    );
  });

  test("should change the days of a workout, and drop it from the home screen", async ({ page }) => {
    await createWorkout(page, "Push day", ["Bench Press"], [today]);
    await page.getByRole("link", { name: "Edit Push day" }).click();
    await expect(page.getByRole("button", { name: today, exact: true })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: today, exact: true }).click();
    await page.getByRole("button", { name: tomorrow, exact: true }).click();
    await page.getByRole("button", { name: "Save workout" }).click();

    await goTo(page, "Home");
    await expect(page.getByText("Nothing planned for today.")).toBeVisible();
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
    await page.getByRole("link", { name: "Continue" }).click();
    await expect(page.getByRole("button", { name: "Finish Workout" })).toBeVisible();
  });

  test("should show this week's numbers and the body weight", async ({ page, user }) => {
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
    await expect(week.locator("p", { hasText: /^Workouts$/ }).locator("..")).toContainText("1");
    await expect(week.locator("p", { hasText: /^Sets$/ }).locator("..")).toContainText("2");
    await expect(week.locator("p", { hasText: /^Volume$/ }).locator("..")).toContainText("1,000");
    await expect(week.locator("p", { hasText: /^Body weight$/ }).locator("..")).toContainText("–");
    await expect(page.getByRole("heading", { name: "Training calendar" })).toBeVisible();
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
