import { test, expect, gotoApp, newTestUser, signUp } from "./fixtures";
import { getDb } from "./db";
import { addMovement, addSet, selectMovement, setRows, setTexts, startWorkout } from "./helpers";

// Every test starts with a signed-in user and an active workout. Bench Press and Back Squat are in the library.
test.beforeEach(async ({ page }) => {
  await startWorkout(page);
});

test.describe("Sets", () => {
  test.describe("create", () => {
    test("should add a set to the current workout", async ({ page }) => {
      await addSet(page, { movement: "Bench Press", weight: 100, reps: 5 });

      await expect(setRows(page)).toHaveCount(1);
      await expect(page.locator(".Toastify__toast")).toHaveCount(0);
    });

    test("should show the set form only for a movement, and require weight and reps to add a set", async ({ page }) => {
      // No movement picked: no form, no movement picker on the page, only the button to add one.
      await expect(page.getByLabel("Weight")).toHaveCount(0);
      await expect(page.getByLabel("Reps")).toHaveCount(0);
      await expect(page.getByRole("combobox")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Add movement", exact: true })).toBeVisible();

      await selectMovement(page, "Bench Press");
      const add = page.getByRole("button", { name: "Add", exact: true });
      const weight = page.getByLabel("Weight", { exact: true });
      const reps = page.getByLabel("Reps", { exact: true });

      await expect(add, "movement only").toBeDisabled();
      await weight.fill("100");
      await expect(add, "movement and weight without reps").toBeDisabled();
      await weight.clear();
      await reps.fill("5");
      await expect(add, "movement and reps without a weight").toBeDisabled();
      await weight.fill("100");
      await expect(add, "all three").toBeEnabled();

      // Pressing Enter with a field missing must not add anything either.
      await reps.clear();
      await weight.press("Enter");
      await expect(page.getByText("No sets yet")).toBeVisible();
    });

    test("should display the new set in the workout", async ({ page }) => {
      await expect(page.getByText("No sets yet. Add exercises to your workout!")).toBeVisible();

      await addSet(page, { movement: "Bench Press", weight: 100, reps: 5 });

      await expect(page.getByText("No sets yet")).toHaveCount(0);
      await expect(setRows(page)).toHaveCount(1);
      // The reps field is cleared for the next set. The weight stays, because the next set is often the same.
      await expect(page.getByLabel("Reps")).toHaveValue("");
      await expect(page.getByLabel("Weight")).toHaveValue("100");

      // It was saved: a reload still shows it.
      await page.reload();
      await expect(setRows(page)).toHaveCount(1);
    });
  });

  test.describe("read", () => {
    test("should display sets with movement name, weight, and reps", async ({ page }) => {
      await addSet(page, { movement: "Bench Press", weight: 100, reps: 5 });
      await addSet(page, { movement: "Back Squat", weight: 62.5, reps: 8 });

      const bench = setRows(page).filter({ hasText: "Bench Press" });
      await expect(bench).toContainText("5 reps × 100 lbs");
      const squat = setRows(page).filter({ hasText: "Back Squat" });
      // A decimal weight is shown as typed.
      await expect(squat).toContainText("8 reps × 62.5 lbs");
    });

    test("should show sets in the order they were added", async ({ page }) => {
      for (const weight of [10, 20, 30, 40, 50]) await addSet(page, { movement: "Bench Press", weight, reps: 5 });

      // Removing a set and adding another is what used to scramble the order,
      // because the database reuses the freed space and the list had no sort.
      await setRows(page)
        .filter({ hasText: "× 20 lbs" })
        .getByRole("button", { name: /^Remove/ })
        .click();
      await expect(setRows(page)).toHaveCount(4);
      await addSet(page, { movement: "Bench Press", weight: 60, reps: 5 });

      const weights = (texts: string[]) => texts.map((text) => text.match(/× ([\d.]+) lbs/)![1]);
      expect(weights(await setTexts(page))).toEqual(["10", "30", "40", "50", "60"]);

      await page.reload();
      await expect(setRows(page)).toHaveCount(5);
      expect(weights(await setTexts(page))).toEqual(["10", "30", "40", "50", "60"]);
    });
  });

  test.describe("delete", () => {
    test("should remove a set from the current workout", async ({ page }) => {
      await addSet(page, { movement: "Bench Press", weight: 100, reps: 5 });
      await addSet(page, { movement: "Back Squat", weight: 150, reps: 3 });

      await page.getByRole("button", { name: "Remove Bench Press set" }).click();

      await expect(setRows(page).filter({ hasText: "Bench Press" })).toHaveCount(0);
      await expect(setRows(page).filter({ hasText: "Back Squat" })).toHaveCount(1);
    });

    test("should update the sets list after deletion", async ({ page }) => {
      await addSet(page, { movement: "Bench Press", weight: 100, reps: 5 });
      await addSet(page, { movement: "Bench Press", weight: 105, reps: 3 });
      await expect(setRows(page)).toHaveCount(2);

      await page.getByRole("button", { name: "Remove Bench Press set" }).first().click();
      await expect(setRows(page)).toHaveCount(1);

      await page.getByRole("button", { name: "Remove Bench Press set" }).click();
      await expect(page.getByText("No sets yet. Add exercises to your workout!")).toBeVisible();

      // The deletion was saved: a reload does not bring them back.
      await page.reload();
      await expect(page.getByText("No sets yet. Add exercises to your workout!")).toBeVisible();
    });
  });

  // The page shows what was true when it loaded. Another tab, or a request that was edited, can ask for something the
  // server refuses. The user has to be told, the page has to show what the server has now, and what they typed has
  // to stay: in the form while the workout is open, and for the next workout when it is not.
  test.describe("failures", () => {
    const toast = (page: import("@playwright/test").Page) => page.locator(".Toastify__toast");

    test("should show an error when the movement belongs to another user", async ({ page, browser }) => {
      const other = newTestUser();
      const otherContext = await browser.newContext();
      const otherPage = await otherContext.newPage();
      await signUp(otherPage, other);
      await addMovement(otherPage, "Other Users Movement");
      await otherContext.close();
      const foreign = await getDb().movement.findFirstOrThrow({ where: { user: { email: other.email } } });

      // The menu only offers the user's own and the built-in movements, so swap the id in the request the way an
      // edited request would.
      const own = await getDb().movement.findFirstOrThrow({ where: { userId: null, name: "Bench Press" } });
      await page.route("**/_serverFn/**", async (route) => {
        const body = route.request().postData();
        if (route.request().method() === "POST" && body?.includes(own.id)) {
          await route.continue({ postData: body.replaceAll(own.id, foreign.id) });
        } else await route.continue();
      });
      await selectMovement(page, "Bench Press");
      await page.getByLabel("Weight").fill("100");
      await page.getByLabel("Reps").fill("5");
      await page.getByRole("button", { name: "Add", exact: true }).click();

      await expect(toast(page)).toContainText("Movement not found");
      await expect(page.getByLabel("Reps")).toHaveValue("5");
      await page.reload();
      await expect(setRows(page)).toHaveCount(0);
    });

    test("should show an error when the set was already removed in another tab", async ({ page }) => {
      await addSet(page, { movement: "Bench Press", weight: 100, reps: 5 });
      const otherTab = await page.context().newPage();
      await gotoApp(otherTab, "/current-workout");
      await otherTab.getByRole("button", { name: "Remove Bench Press set" }).click();
      await expect(setRows(otherTab)).toHaveCount(0);

      await page.getByRole("button", { name: "Remove Bench Press set" }).click();

      await expect(toast(page)).toContainText("Set not found");
    });

    test("should refresh the sets list after a removal the server refused", async ({ page }) => {
      await addSet(page, { movement: "Bench Press", weight: 100, reps: 5 });
      await addSet(page, { movement: "Back Squat", weight: 150, reps: 3 });
      const otherTab = await page.context().newPage();
      await gotoApp(otherTab, "/current-workout");
      await otherTab.getByRole("button", { name: "Remove Bench Press set" }).click();
      await expect(setRows(otherTab)).toHaveCount(1);

      await page.getByRole("button", { name: "Remove Bench Press set" }).click();

      await expect(toast(page)).toContainText("Set not found");
      // The page was out of date. The removed set is gone, and the other one is still there.
      await expect(setRows(page)).toHaveCount(1);
      await expect(setRows(page).filter({ hasText: "Back Squat" })).toHaveCount(1);
    });

    test("should show an error, then no workout, and save nothing when the workout was completed in another tab", async ({
      page,
    }) => {
      const otherTab = await page.context().newPage();
      await gotoApp(otherTab, "/current-workout");
      await otherTab.getByRole("button", { name: "Finish Workout" }).click();
      await expect(otherTab.getByText("No active workout. Ready to start?")).toBeVisible();

      await selectMovement(page, "Bench Press");
      await page.getByLabel("Weight").fill("100");
      await page.getByLabel("Reps").fill("7");
      await page.getByRole("button", { name: "Add", exact: true }).click();

      await expect(toast(page)).toContainText("No active workout");
      // The form belongs to a workout, so it goes with it, and nothing was saved.
      await expect(page.getByText("No active workout. Ready to start?")).toBeVisible();
      await expect(setRows(page)).toHaveCount(0);
    });
  });
});
