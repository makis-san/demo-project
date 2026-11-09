import { test, expect, gotoApp, newTestUser, signUp } from "./fixtures";
import { getDb, seedCompletedWorkouts } from "./db";
import { completeWorkout, goTo, selectMovement, setRows, startWorkout, pressStart } from "./helpers";

const sample = [
  { movement: "Bench Press", weight: 100, reps: 5 },
  { movement: "Bench Press", weight: 105, reps: 3 },
  { movement: "Back Squat", weight: 150, reps: 5 },
];

const rows = (page: import("@playwright/test").Page) =>
  page.getByRole("row").filter({ has: page.getByRole("checkbox", { name: "Select workout" }) });
const repeat = (page: import("@playwright/test").Page) =>
  rows(page).first().getByRole("button", { name: "Repeat this workout" });
const progress = (page: import("@playwright/test").Page, text: string) =>
  expect(page.getByText(text, { exact: true })).toBeVisible();
/** Opens the Start screen for a past workout and presses Start, the way a user repeats it. */
async function repeatAndStart(page: import("@playwright/test").Page) {
  await repeat(page).click();
  await expect(page.getByRole("heading", { level: 1, name: "Repeat a past workout" })).toBeVisible();
  await pressStart(page);
  await expect(page).toHaveURL(/\/current-workout/);
}
const logButton = (page: import("@playwright/test").Page, movement: string, reps: number, weight: number) =>
  page.getByRole("button", { name: `Log planned ${movement} set: ${reps} × ${weight} lbs` });

test.describe("Repeat a workout", () => {
  test("should start a workout with the old sets as a checklist, not as logged sets", async ({ page, user }) => {
    await completeWorkout(page, sample);
    await goTo(page, "Workout History");
    await repeat(page).click();

    // The old workout is shown as a plan first. Nothing has started: no workout, no clock.
    await expect(page).toHaveURL(/\/start-workout/);
    await expect(page.getByRole("heading", { level: 1, name: "Repeat a past workout" })).toBeVisible();
    await expect(page.getByRole("list", { name: "Movements in this workout" }).locator("[data-movement]")).toHaveCount(
      2,
    );
    await expect(page.getByRole("button", { name: "Finish Workout" })).toHaveCount(0);
    expect(await getDb().workout.count({ where: { completedAt: null, user: { email: user.email } } })).toBe(0);
    await pressStart(page);

    await expect(page).toHaveURL(/\/current-workout/);
    await expect(page.getByRole("button", { name: "Finish Workout" })).toBeVisible();
    await expect(page.getByText(/^Planned from /)).toBeVisible();
    await progress(page, "0 of 3 logged");
    await expect(page.getByRole("list", { name: "Planned Bench Press sets" }).getByRole("listitem")).toHaveCount(2);
    await expect(page.getByRole("list", { name: "Planned Back Squat sets" }).getByRole("listitem")).toHaveCount(1);
    // Nothing was logged: the workout has no sets yet.
    await expect(setRows(page)).toHaveCount(0);
    await expect(page.getByText("No sets yet")).toBeVisible();
  });

  test("should log a planned set with the old weight and reps, and keep the ticks after a reload", async ({ page }) => {
    await completeWorkout(page, sample);
    await goTo(page, "Workout History");
    await repeatAndStart(page);

    await logButton(page, "Bench Press", 5, 100).click();
    await expect(setRows(page)).toHaveCount(1);
    await expect(setRows(page)).toContainText("5 reps × 100 lbs");
    await progress(page, "1 of 3 logged");

    await page.reload();
    await progress(page, "1 of 3 logged");
    await expect(
      page.getByRole("list", { name: "Planned Bench Press sets" }).getByRole("listitem").first(),
    ).toHaveAttribute("data-done", "true");
    // The done one has no button left, the next one does.
    await expect(logButton(page, "Bench Press", 5, 100)).toHaveCount(0);
    await expect(logButton(page, "Bench Press", 105, 3)).toHaveCount(0);
    await expect(logButton(page, "Bench Press", 3, 105)).toBeVisible();
  });

  test("should let the weight and reps change before a planned set is logged", async ({ page }) => {
    await completeWorkout(page, sample);
    await goTo(page, "Workout History");
    await repeatAndStart(page);

    await page.getByRole("button", { name: "Adjust planned Back Squat set: 5 × 150 lbs" }).click();
    // The movement, weight and reps are in the form, and nothing is logged yet.
    await expect(page.getByRole("group", { name: "Selected movement" })).toContainText("Back Squat");
    await expect(page.getByLabel("Weight", { exact: true })).toHaveValue("150");
    await expect(page.getByLabel("Reps", { exact: true })).toHaveValue("5");
    await expect(setRows(page)).toHaveCount(0);

    await page.getByLabel("Weight", { exact: true }).fill("155");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(setRows(page)).toContainText("5 reps × 155 lbs");
    await progress(page, "1 of 3 logged");
  });

  test("should leave a skipped planned set out of history, charts and records", async ({ page }) => {
    await completeWorkout(page, sample);
    await goTo(page, "Workout History");
    await repeatAndStart(page);
    await logButton(page, "Bench Press", 5, 100).click();
    await expect(setRows(page)).toHaveCount(1);
    await page.getByRole("button", { name: "Finish Workout" }).click();
    await expect(page.getByText("No active workout. Ready to start?")).toBeVisible();

    await goTo(page, "Workout History");
    // Two workouts, the new one with 1 set and the old one with 3. The 2 skipped sets are not there.
    await expect(rows(page).locator("td:nth-child(3)")).toHaveText(["1", "3"]);
    await expect(
      page.getByRole("list", { name: "Sets per muscle group" }).locator("[data-muscle='chest']"),
    ).toContainText("3");
  });

  test("should not start a second workout while one is active", async ({ page }) => {
    await completeWorkout(page, sample);
    await goTo(page, "Workout History");
    await repeatAndStart(page);
    await expect(page.getByRole("button", { name: "Finish Workout" })).toBeVisible();

    // With a workout open the button is off, and says why.
    await goTo(page, "Workout History");
    await expect(page.getByText("You have a workout in progress.")).toBeVisible();
    await expect(repeat(page)).toBeDisabled();
    await expect(repeat(page)).toHaveAttribute("title", "Finish your current workout first");
  });

  test("should refuse on the server when a workout was started in another tab", async ({ page, user }) => {
    await completeWorkout(page, sample);
    await goTo(page, "Workout History");
    await repeat(page).click();
    await expect(page.getByRole("button", { name: "Start workout" })).toBeEnabled();

    // This page still thinks there is no active workout.
    const otherTab = await page.context().newPage();
    await gotoApp(otherTab, "/home");
    await startWorkout(otherTab);
    await page.bringToFront();
    await expect(page.getByRole("button", { name: "Start workout" })).toBeEnabled();
    // 3, 2, 1, GO, and then the server says no.
    await pressStart(page, { wait: false });

    await expect(page.locator(".Toastify__toast")).toContainText(
      "Finish your current workout before starting another",
      {
        timeout: 15_000,
      },
    );
    // Still one workout open, and it is the one from the other tab, with no checklist.
    expect(await getDb().workout.count({ where: { completedAt: null, user: { email: user.email } } })).toBe(1);
    expect(
      await getDb().workout.count({ where: { sourceWorkoutId: { not: null }, user: { email: user.email } } }),
    ).toBe(0);
  });

  test("should keep working when the workout it came from is deleted", async ({ page }) => {
    await completeWorkout(page, sample);
    await goTo(page, "Workout History");
    await repeatAndStart(page);
    await progress(page, "0 of 3 logged");

    await goTo(page, "Workout History");
    await rows(page).first().getByRole("checkbox").check();
    await page.getByRole("button", { name: "Delete Selected (1)" }).click();
    await expect(rows(page)).toHaveCount(0);

    await goTo(page, "Current Workout");
    await expect(page.getByRole("button", { name: "Finish Workout" })).toBeVisible();
    await expect(page.getByText(/^Planned from /)).toHaveCount(0);
    // The workout still takes sets.
    await selectMovement(page, "Bench Press");
    await page.getByLabel("Weight", { exact: true }).fill("100");
    await page.getByLabel("Reps", { exact: true }).fill("5");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(setRows(page)).toHaveCount(1);
  });

  test("should not repeat another user's workout", async ({ page, browser, user }) => {
    const other = newTestUser();
    const otherContext = await browser.newContext();
    await signUp(await otherContext.newPage(), other);
    const [foreignId] = await seedCompletedWorkouts(other.email, [
      { completedAt: new Date(Date.now() - 86400000), sets: [sample[0]] },
    ]);
    await otherContext.close();

    await completeWorkout(page, sample);
    await goTo(page, "Workout History");
    const own = await getDb().workout.findFirstOrThrow({ where: { user: { email: user.email } } });
    await repeat(page).click();
    await page.route("**/_serverFn/**", async (route) => {
      const body = route.request().postData();
      if (route.request().method() === "POST" && body?.includes(own.id)) {
        await route.continue({ postData: body.replaceAll(own.id, foreignId) });
      } else await route.continue();
    });
    await pressStart(page, { wait: false });

    await expect(page.locator(".Toastify__toast")).toContainText("Workout not found", { timeout: 15_000 });
    expect(await getDb().workout.count({ where: { sourceWorkoutId: foreignId } })).toBe(0);
    await page.unroute("**/_serverFn/**");
    // And the Start screen will not show it.
    await page.goto(`/start-workout?from=${foreignId}`);
    await expect(page.getByText("That workout doesn't exist.")).toBeVisible();
  });
});
