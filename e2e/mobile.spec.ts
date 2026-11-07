import { test as signedOut, expect as expectSignedOut, type Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { seedCompletedWorkouts } from "./db";
import { addMovement, addSet, goTo, logBodyWeight, setRows, startWorkout } from "./helpers";
import { gotoApp } from "./fixtures";

// A phone: the sidebar becomes a bar along the bottom. The rest of the suite runs at a desktop size.
const phone = { width: 390, height: 844 };

/** The page is as wide as the window, so nothing can be scrolled sideways. */
async function expectNoSidewaysScroll(page: Page) {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
}

signedOut.describe("Phone, signed out", () => {
  signedOut.use({ viewport: phone });

  for (const path of ["/sign-in", "/create-account"]) {
    signedOut(`should fit ${path} in the window`, async ({ page }) => {
      await gotoApp(page, path);
      await expectSignedOut(page.getByRole("button", { name: /^(Sign in|Create account)$/ })).toBeVisible();
      await expectNoSidewaysScroll(page);
    });
  }
});

test.describe("Phone, signed in", () => {
  test.use({ viewport: phone });

  test("should log a set with every control inside the window", async ({ page }) => {
    await addMovement(page, "Bench Press");
    await startWorkout(page);

    // Each control has the whole width, and the Add button is on the screen and not too small to tap.
    for (const control of [page.getByLabel("Movement"), page.getByLabel("Weight"), page.getByLabel("Reps")]) {
      const box = await control.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(phone.width);
      expect(box!.width).toBeGreaterThan(phone.width / 2);
    }
    const add = await page.getByRole("button", { name: "Add", exact: true }).boundingBox();
    expect(add!.x + add!.width).toBeLessThanOrEqual(phone.width);
    expect(add!.height).toBeGreaterThanOrEqual(40);

    await addSet(page, { movement: "Bench Press", weight: 100, reps: 5 });
    await expect(setRows(page)).toContainText("5 reps × 100 lbs");
    await expectNoSidewaysScroll(page);
  });

  test("should bring up a number keypad for weight and reps", async ({ page }) => {
    await startWorkout(page);

    await expect(page.getByLabel("Weight")).toHaveAttribute("inputmode", "decimal");
    await expect(page.getByLabel("Reps")).toHaveAttribute("inputmode", "numeric");
    await goTo(page, "Body Weight");
    await expect(page.getByLabel("Weight in lbs")).toHaveAttribute("inputmode", "decimal");
  });

  test("should fit every signed-in page in the window", async ({ page, user }) => {
    // Long names and many columns are what pushed the pages wide.
    const names = ["Barbell Back Squat With Pause", "Romanian Deadlift", "Overhead Press Standing", "Weighted Pull-up"];
    for (const name of names) await addMovement(page, name);
    await seedCompletedWorkouts(
      user.email,
      Array.from({ length: 5 }, (_, i) => ({
        completedAt: new Date(Date.now() - (i + 1) * 24 * 60 * 60 * 1000),
        sets: names.map((movement, j) => ({ movement, weight: 100 + i + j, reps: 5 })),
      })),
    );
    await logBodyWeight(page, 180.5);
    await startWorkout(page);
    await addSet(page, { movement: names[0], weight: 225, reps: 5 });
    await expectNoSidewaysScroll(page);

    await goTo(page, "Movements");
    await expectNoSidewaysScroll(page);

    await goTo(page, "Body Weight");
    await expectNoSidewaysScroll(page);

    // Reloaded, so the history shows the workouts seeded behind the page's back.
    await page.goto("/workout-history");
    await expect(page.getByRole("heading", { level: 1, name: "Workout History" })).toBeVisible();
    await expect(page.getByRole("img", { name: /over time$/ })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: names[3] })).toBeVisible();
    await expectNoSidewaysScroll(page);

    // The wide table moves inside its card, not the page.
    const table = page.locator("div.overflow-x-auto").filter({ has: page.getByRole("table") });
    const { client, scroll } = await table.evaluate((el) => ({ client: el.clientWidth, scroll: el.scrollWidth }));
    expect(scroll).toBeGreaterThan(client);
  });

  test("should reach every page and log out from the bar at the bottom", async ({ page }) => {
    for (const section of ["Workout History", "Movements", "Body Weight", "Current Workout"] as const) {
      await goTo(page, section);
    }

    const logOut = page.getByRole("button", { name: "Log out" });
    const box = await logOut.boundingBox();
    expect(box!.y + box!.height).toBeLessThanOrEqual(phone.height);
    expect(box!.y).toBeGreaterThan(phone.height / 2);
    await logOut.click();

    await expect(page).toHaveURL(/\/sign-in/);
    expect((await page.context().cookies()).find((c) => c.name === "session")).toBeUndefined();
  });
});
