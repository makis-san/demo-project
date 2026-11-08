import { test, expect, gotoApp } from "./fixtures";
import { breakWrites, getDb } from "./db";
import { addMovement, addSet, completeWorkout, goTo, setRows, startWorkout } from "./helpers";

const noActiveWorkout = "No active workout. Ready to start?";

/** The date the page should show for a stored time, written the way the app writes it, in the browser's timezone. */
function fullDate(page: import("@playwright/test").Page, iso: string) {
  return page.evaluate(
    (value) =>
      new Date(value).toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" }),
    iso,
  );
}

test.describe("Workouts", () => {
  test.describe("create", () => {
    test("should start a new workout from the current workout page", async ({ page }) => {
      await expect(page.getByText(noActiveWorkout)).toBeVisible();
      await expect(page.getByRole("button", { name: "Complete Workout" })).toHaveCount(0);

      await page.getByRole("button", { name: "Start Workout" }).click();

      await expect(page.getByRole("button", { name: "Complete Workout" })).toBeVisible();
      await expect(page.getByText("No sets yet. Add exercises to your workout!")).toBeVisible();
      await expect(page.getByText(noActiveWorkout)).toHaveCount(0);
    });

    test("should show the workout date after starting", async ({ page, user }) => {
      await startWorkout(page);
      const title = page.locator("h3").first();

      // The date on the page must come from the stored start time, not from the clock.
      const workout = await getDb().workout.findFirstOrThrow({ where: { user: { email: user.email } } });
      await expect(title).toHaveText(await fullDate(page, workout.startedAt.toISOString()));

      // Move the start back three days, as if the workout had been left open. The page must follow the stored value.
      const threeDaysAgo = new Date(workout.startedAt.getTime() - 3 * 24 * 60 * 60 * 1000);
      await getDb().workout.update({ where: { id: workout.id }, data: { startedAt: threeDaysAgo } });
      await page.reload();

      const expected = await fullDate(page, threeDaysAgo.toISOString());
      await expect(title).toHaveText(expected);
      expect(expected).not.toBe(await fullDate(page, new Date().toISOString()));
    });
  });

  test.describe("read", () => {
    test("should display the current active workout", async ({ page }) => {
      await addMovement(page, "Bench Press");
      await startWorkout(page);
      await addSet(page, { movement: "Bench Press", weight: 100, reps: 5 });

      // After a reload the same workout comes back from the server, with its set.
      await page.reload();
      await expect(page.getByRole("button", { name: "Complete Workout" })).toBeVisible();
      await expect(setRows(page)).toHaveCount(1);
      await expect(setRows(page)).toContainText("Bench Press");
    });

    test("should show 'No active workout' when none exists", async ({ page }) => {
      await expect(page.getByText(noActiveWorkout)).toBeVisible();
      await expect(page.getByRole("button", { name: "Start Workout" })).toBeVisible();

      // Also true again after a workout is completed.
      await startWorkout(page);
      await page.getByRole("button", { name: "Complete Workout" }).click();
      await expect(page.getByText(noActiveWorkout)).toBeVisible();
    });

    test("should display completed workouts in workout history", async ({ page }) => {
      await addMovement(page, "Bench Press");
      await completeWorkout(page, [
        { movement: "Bench Press", weight: 100, reps: 5 },
        { movement: "Bench Press", weight: 105, reps: 3 },
      ]);

      await goTo(page, "Workout History");
      const rows = page.getByRole("row").filter({ has: page.getByRole("checkbox", { name: "Select workout" }) });
      await expect(rows).toHaveCount(1);
      // Number of sets, and the movement summary: heaviest weight, average reps, set count.
      await expect(rows.getByRole("cell").nth(2)).toHaveText("2");
      await expect(rows).toContainText("105 lbs / 4 reps / 2 sets");
    });
  });

  test.describe("complete", () => {
    test("should mark the current workout as completed", async ({ page }) => {
      await startWorkout(page);

      await page.getByRole("button", { name: "Complete Workout" }).click();

      await expect(page.getByText(noActiveWorkout)).toBeVisible();
      await expect(page.getByRole("button", { name: "Complete Workout" })).toHaveCount(0);
      // The server agrees: a reload does not bring the workout back.
      await page.reload();
      await expect(page.getByText(noActiveWorkout)).toBeVisible();
    });

    test("should move completed workout to history", async ({ page }) => {
      await addMovement(page, "Bench Press");
      await goTo(page, "Workout History");
      await expect(page.getByText("No completed workouts yet.")).toBeVisible();

      await completeWorkout(page, [{ movement: "Bench Press", weight: 100, reps: 5 }]);

      await goTo(page, "Workout History");
      await expect(page.getByText("No completed workouts yet.")).toHaveCount(0);
      await expect(page.getByRole("checkbox", { name: "Select workout" })).toHaveCount(1);
    });
  });

  test.describe("complete when it is already completed", () => {
    test("should show an error when the workout was completed in another tab", async ({ page }) => {
      await startWorkout(page);
      const otherTab = await page.context().newPage();
      await gotoApp(otherTab, "/current-workout");
      await otherTab.getByRole("button", { name: "Complete Workout" }).click();
      await expect(otherTab.getByText(noActiveWorkout)).toBeVisible();

      await page.getByRole("button", { name: "Complete Workout" }).click();

      await expect(page.locator(".Toastify__toast")).toContainText("No active workout to complete");
      // The page was out of date. It shows the state the server has, which is no workout.
      await expect(page.getByText(noActiveWorkout)).toBeVisible();
      await expect(page.getByRole("button", { name: "Complete Workout" })).toHaveCount(0);
    });
  });

  test.describe("delete", () => {
    /** Completes workouts with 1, 2, ... sets, so each row in history can be told apart by its set count. */
    async function completeWorkoutsWithSetCounts(page: import("@playwright/test").Page, counts: number[]) {
      await addMovement(page, "Bench Press");
      for (const count of counts) {
        await completeWorkout(
          page,
          Array.from({ length: count }, (_, i) => ({ movement: "Bench Press", weight: 100 + i, reps: 5 })),
        );
      }
      await goTo(page, "Workout History");
    }

    const historyRows = (page: import("@playwright/test").Page) =>
      page.getByRole("row").filter({ has: page.getByRole("checkbox", { name: "Select workout" }) });

    test("should delete selected workouts from history", async ({ page }) => {
      await completeWorkoutsWithSetCounts(page, [1, 2]);
      await expect(historyRows(page)).toHaveCount(2);

      await historyRows(page)
        .filter({ has: page.getByRole("cell", { name: "2", exact: true }) })
        .getByRole("checkbox")
        .check();
      await page.getByRole("button", { name: "Delete Selected (1)" }).click();

      await expect(historyRows(page)).toHaveCount(1);
      await expect(historyRows(page).getByRole("cell").nth(2)).toHaveText("1");
      // Deleted for good: a reload does not bring it back.
      await page.reload();
      await expect(historyRows(page)).toHaveCount(1);
    });

    test("should keep a workout and its sets when the delete fails", async ({ page, user }) => {
      await completeWorkoutsWithSetCounts(page, [3]);
      const workout = await getDb().workout.findFirstOrThrow({ where: { user: { email: user.email } } });
      // The database fails after it has already removed the sets. Everything has to be undone.
      const repair = await breakWrites("Workout", "AFTER DELETE", `OLD.id = '${workout.id}'`);
      try {
        await historyRows(page).getByRole("checkbox").check();
        await page.getByRole("button", { name: "Delete Selected (1)" }).click();

        await expect(page.locator(".Toastify__toast")).toContainText("Something went wrong");
        await expect(historyRows(page)).toHaveCount(1);
        expect(await getDb().set.count({ where: { workoutId: workout.id } })).toBe(3);
      } finally {
        await repair();
      }

      // With the failure gone the same delete works, and removes the sets with the workout.
      await page.getByRole("button", { name: "Delete Selected (1)" }).click();
      await expect(historyRows(page)).toHaveCount(0);
      expect(await getDb().workout.count({ where: { id: workout.id } })).toBe(0);
      expect(await getDb().set.count({ where: { workoutId: workout.id } })).toBe(0);
    });

    test("should allow selecting multiple workouts for deletion", async ({ page }) => {
      await completeWorkoutsWithSetCounts(page, [1, 2, 3]);
      const deleteButton = page.getByRole("button", { name: /Delete Selected/ });
      await expect(deleteButton).toBeDisabled();

      const checkboxes = historyRows(page).getByRole("checkbox");
      await checkboxes.nth(0).check();
      await checkboxes.nth(1).check();
      await expect(deleteButton).toHaveText("Delete Selected (2)");

      // Select all, then clear again.
      await page.getByRole("checkbox", { name: "Select all workouts" }).check();
      await expect(deleteButton).toHaveText("Delete Selected (3)");
      await page.getByRole("checkbox", { name: "Select all workouts" }).uncheck();
      await expect(deleteButton).toHaveText("Delete Selected (0)");
      await expect(deleteButton).toBeDisabled();

      await checkboxes.nth(0).check();
      await checkboxes.nth(2).check();
      await deleteButton.click();

      await expect(historyRows(page)).toHaveCount(1);
    });
  });
});
