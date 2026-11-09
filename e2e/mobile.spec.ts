import { test as signedOut, expect as expectSignedOut, type Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { seedCompletedWorkouts } from "./db";
import { addMovement, addSet, goTo, logBodyWeight, selectMovement, setRows, startWorkout } from "./helpers";
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
    await startWorkout(page);

    // The button for an extra movement is on the screen and big enough to tap.
    const addMovementButton = await page.getByRole("button", { name: "Add movement", exact: true }).boundingBox();
    expect(addMovementButton!.x).toBeGreaterThanOrEqual(0);
    expect(addMovementButton!.x + addMovementButton!.width).toBeLessThanOrEqual(phone.width);
    expect(addMovementButton!.height).toBeGreaterThanOrEqual(36);
    await selectMovement(page, "Bench Press");

    // Each control has the whole width, and the Add button is on the screen and not too small to tap.
    for (const control of [
      page.getByRole("group", { name: "Selected movement" }),
      page.getByLabel("Weight", { exact: true }),
      page.getByLabel("Reps", { exact: true }),
    ]) {
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
    await selectMovement(page, "Bench Press");

    await expect(page.getByLabel("Weight", { exact: true })).toHaveAttribute("inputmode", "decimal");
    await expect(page.getByLabel("Reps", { exact: true })).toHaveAttribute("inputmode", "numeric");
    await goTo(page, "Body Weight");
    await expect(page.getByLabel("Weight in lbs")).toHaveAttribute("inputmode", "decimal");
  });

  test("should fit every signed-in page in the window", async ({ page, user }) => {
    // Long names and many columns are what pushed the pages wide.
    const names = [
      "Barbell Back Squat With Pause",
      "Romanian Deadlift Slow Tempo",
      "Overhead Press Standing",
      "Weighted Pull-up",
    ];
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

/** The smallest size, in pixels on the screen, of the text in the chart: its font size times the chart's scale. */
async function smallestChartTextPx(page: Page) {
  return page.getByRole("img", { name: /over time$/ }).evaluate((svg: SVGSVGElement) => {
    const scale = svg.getScreenCTM()!.a;
    const sizes = [...svg.querySelectorAll("text")].map((text) => parseFloat(getComputedStyle(text).fontSize) * scale);
    return Math.min(...sizes);
  });
}

/** How far the chart's own box scrolls sideways: more than 0 means part of the chart is out of sight. */
async function chartOverflow(page: Page) {
  return page.getByRole("img", { name: /over time$/ }).evaluate((svg) => {
    const box = svg.parentElement!;
    return box.scrollWidth - box.clientWidth;
  });
}

test.describe("Charts on a phone", () => {
  test.use({ viewport: phone });

  test("should draw the axis labels at a readable size, and scroll the chart instead of the page", async ({
    page,
    user,
  }) => {
    await seedCompletedWorkouts(
      user.email,
      Array.from({ length: 6 }, (_, i) => ({
        completedAt: new Date(Date.now() - (i + 1) * 24 * 60 * 60 * 1000),
        sets: [{ movement: "Bench Press", weight: 100 + i, reps: 5 }],
      })),
    );
    await logBodyWeight(page, 180.5);
    await logBodyWeight(page, 181);

    for (const section of ["Workout History", "Body Weight"] as const) {
      // Reloaded, so history shows the workouts seeded behind the page's back.
      await page.goto(section === "Workout History" ? "/workout-history" : "/body-weight");
      await expect(page.getByRole("img", { name: /over time$/ })).toBeVisible();

      // 11px is the size the labels are drawn at. Scaled down to the card's width they were about 5px.
      expect(await smallestChartTextPx(page), `${section} chart text`).toBeGreaterThanOrEqual(10.9);
      await expectNoSidewaysScroll(page);
      expect(await chartOverflow(page), `${section} chart overflow`).toBeGreaterThan(0);
    }
  });
});

test.describe("Charts on a desktop", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("should fill the card without scrolling, with larger labels than on a phone", async ({ page, user }) => {
    await seedCompletedWorkouts(
      user.email,
      Array.from({ length: 6 }, (_, i) => ({
        completedAt: new Date(Date.now() - (i + 1) * 24 * 60 * 60 * 1000),
        sets: [{ movement: "Bench Press", weight: 100 + i, reps: 5 }],
      })),
    );

    await page.goto("/workout-history");
    await expect(page.getByRole("img", { name: /over time$/ })).toBeVisible();

    // The chart is as wide as its card, so there is nothing to scroll, and it is drawn as it always was.
    expect(await chartOverflow(page)).toBe(0);
    expect(await smallestChartTextPx(page)).toBeGreaterThan(11);
  });
});
