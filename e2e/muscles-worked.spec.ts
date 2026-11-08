import { test, expect, newTestUser, signUp } from "./fixtures";
import { seedCompletedWorkouts } from "./db";
import { addMovement, addSet, completeWorkout, goTo, startWorkout } from "./helpers";

const day = 24 * 60 * 60 * 1000;
const bench = (weight = 100) => ({ movement: "Bench Press", weight, reps: 5 });

test.describe("Muscles worked", () => {
  test.use({ timezoneId: "America/Recife" });

  test("should count a primary muscle as a set and a secondary muscle as half a set", async ({ page }) => {
    await completeWorkout(page, [bench(), bench(105), bench(110)]);
    await goTo(page, "Workout History");

    await expect(page.getByRole("heading", { name: "Muscles worked" })).toBeVisible();
    // Chest is primary for the bench press, shoulders and triceps are secondary. The busiest group comes first.
    await expect(page.getByRole("list", { name: "Sets per muscle group" }).getByRole("listitem")).toHaveText([
      "Chest3",
      "Shoulders1.5",
      "Triceps1.5",
    ]);
    // The map is lit by the same numbers: the busiest group is fully hot, half the load is half.
    const map = page.getByRole("img", { name: "Muscles worked in the last 7 days, front" });
    await expect(map.locator("[data-muscle='chest']")).toHaveAttribute("data-level", "1");
    await expect(map.locator("[data-muscle='shoulders']")).toHaveAttribute("data-level", "0.5");
    await expect(map.locator("[data-muscle='quads']")).toHaveAttribute("data-level", "0");
    await expect(page.getByText("Not trained: ")).toContainText("Quads");
  });

  test("should add up the muscles of different movements", async ({ page }) => {
    await completeWorkout(page, [bench(), { movement: "Overhead Press", weight: 60, reps: 5 }]);
    await goTo(page, "Workout History");

    // Shoulders: the press is primary (1) and the bench is secondary (0.5). Triceps: secondary for both (0.5 + 0.5).
    const list = page.getByRole("list", { name: "Sets per muscle group" });
    await expect(list.locator("[data-muscle='shoulders']")).toContainText("1.5");
    await expect(list.locator("[data-muscle='triceps']")).toContainText("1");
    await expect(list.locator("[data-muscle='chest']")).toContainText("1");
  });

  test("should show an empty state, not a blank map, when there are no workouts", async ({ page }) => {
    await goTo(page, "Workout History");

    await expect(page.getByText("No completed workouts in the last 7 days.")).toBeVisible();
    await expect(page.getByRole("img", { name: /Muscles worked in the last 7 days/ })).toHaveCount(0);
  });

  test("should not count the sets of a workout that is not completed", async ({ page }) => {
    await startWorkout(page);
    await addSet(page, bench());

    await goTo(page, "Workout History");
    await expect(page.getByText("No completed workouts in the last 7 days.")).toBeVisible();

    await goTo(page, "Current Workout");
    await page.getByRole("button", { name: "Complete Workout" }).click();
    await expect(page.getByText("No active workout. Ready to start?")).toBeVisible();
    await goTo(page, "Workout History");
    await expect(
      page.getByRole("list", { name: "Sets per muscle group" }).locator("[data-muscle='chest']"),
    ).toContainText("1");
  });

  test("should only look at the last 7 days", async ({ page, user }) => {
    await seedCompletedWorkouts(user.email, [
      { completedAt: new Date(Date.now() - 2 * day), sets: [{ movement: "Back Squat", weight: 200, reps: 5 }] },
      { completedAt: new Date(Date.now() - 9 * day), sets: [bench(), bench()] },
    ]);
    await goTo(page, "Workout History");

    const list = page.getByRole("list", { name: "Sets per muscle group" });
    await expect(list.locator("[data-muscle='quads']")).toContainText("1");
    // The bench press was 9 days ago.
    await expect(list.locator("[data-muscle='chest']")).toHaveCount(0);
  });

  test("should count only the user's own sets, though the built-in movements are shared", async ({
    page,
    browser,
    user,
  }) => {
    const other = await browser.newContext();
    const otherPage = await other.newPage();
    const otherUser = newTestUser();
    await signUp(otherPage, otherUser);
    await seedCompletedWorkouts(otherUser.email, [
      { completedAt: new Date(Date.now() - day), sets: [bench(), bench(), bench()] },
    ]);
    await seedCompletedWorkouts(user.email, [{ completedAt: new Date(Date.now() - day), sets: [bench()] }]);
    await other.close();

    await goTo(page, "Workout History");
    await expect(
      page.getByRole("list", { name: "Sets per muscle group" }).locator("[data-muscle='chest']"),
    ).toContainText("1");
    // The history table lists only movements this user did.
    await expect(page.getByRole("columnheader", { name: "Bench Press" })).toBeVisible();
  });

  test("should say how many sets were on movements without muscles", async ({ page, user }) => {
    await addMovement(page, "Plain Lift");
    await seedCompletedWorkouts(user.email, [
      {
        completedAt: new Date(Date.now() - day),
        sets: [
          bench(),
          { movement: "Plain Lift", weight: 50, reps: 5 },
          { movement: "Plain Lift", weight: 50, reps: 5 },
        ],
      },
    ]);
    await goTo(page, "Workout History");

    await expect(page.getByText("2 sets were on movements with no muscles set")).toBeVisible();
    await expect(
      page.getByRole("list", { name: "Sets per muscle group" }).locator("[data-muscle='chest']"),
    ).toContainText("1");
  });

  // The window starts at midnight of the user's own day six days ago, not at the server's.
  test.describe("in another timezone", () => {
    test.use({ timezoneId: "Pacific/Kiritimati" });

    test("should start the 7 days at the user's own midnight", async ({ page, user }) => {
      const zone = "Pacific/Kiritimati";
      const offsetHours = 14; // no daylight saving
      const [y, m, d] = new Date().toLocaleDateString("en-CA", { timeZone: zone }).split("-").map(Number);
      const windowStart = Date.UTC(y, m - 1, d - 6) - offsetHours * 60 * 60 * 1000;
      await seedCompletedWorkouts(user.email, [
        {
          completedAt: new Date(windowStart - 30 * 60 * 1000),
          sets: [{ movement: "Back Squat", weight: 200, reps: 5 }],
        },
        { completedAt: new Date(windowStart + 30 * 60 * 1000), sets: [bench()] },
      ]);
      await goTo(page, "Workout History");

      const list = page.getByRole("list", { name: "Sets per muscle group" });
      await expect(list.locator("[data-muscle='chest']")).toContainText("1");
      // Half an hour before the user's window, so it is out, though it is inside 7 x 24 hours of any other clock.
      await expect(list.locator("[data-muscle='quads']")).toHaveCount(0);
    });
  });
});
