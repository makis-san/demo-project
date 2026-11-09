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

    // With no movement the bar at the bottom is one big button, on the screen and big enough to tap.
    const addMovementButton = await page.getByRole("button", { name: "Add movement", exact: true }).boundingBox();
    expect(addMovementButton!.x).toBeGreaterThanOrEqual(0);
    expect(addMovementButton!.x + addMovementButton!.width).toBeLessThanOrEqual(phone.width);
    expect(addMovementButton!.y + addMovementButton!.height).toBeLessThanOrEqual(phone.height);
    expect(addMovementButton!.height).toBeGreaterThanOrEqual(44);
    await selectMovement(page, "Bench Press");

    // Weight, reps and Add are all on the first screen, with no scrolling, and each is big enough to tap.
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    const weight = (await page.getByLabel("Weight", { exact: true }).boundingBox())!;
    const reps = (await page.getByLabel("Reps", { exact: true }).boundingBox())!;
    const add = (await page.getByRole("button", { name: "Add", exact: true }).boundingBox())!;
    for (const box of [weight, reps, add]) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(phone.width);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(phone.height);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
    // Weight and reps are side by side, and Add takes at least half of the width.
    expect(weight.x + weight.width).toBeLessThanOrEqual(reps.x);
    expect(Math.abs(weight.y - reps.y)).toBeLessThan(2);
    expect(add.width).toBeGreaterThanOrEqual(phone.width / 2);
    // The movement is a row to tap, to change it.
    const row = (await page.getByRole("button", { name: /^Change movement/ }).boundingBox())!;
    expect(row.x + row.width).toBeLessThanOrEqual(phone.width);
    expect(row.height).toBeGreaterThanOrEqual(44);

    await addSet(page, { movement: "Bench Press", weight: 100, reps: 5 });
    await expect(setRows(page)).toContainText("5 reps × 100 lbs");
    await expectNoSidewaysScroll(page);
  });

  test("should hide the dock during a workout, and bring it back on Home with Resume", async ({ page }) => {
    const dock = page.getByRole("navigation", { name: "Main" });
    // No workout: the empty state has the dock.
    await goTo(page, "Current Workout");
    await expect(page.getByText("No active workout. Ready to start?")).toBeVisible();
    await expect(dock).toBeVisible();

    await startWorkout(page);
    // The workout is the whole screen: no dock, a top bar instead, and the h1 is still there for a screen reader.
    await expect(dock).toBeHidden();
    await expect(page.getByRole("link", { name: "Current Workout", exact: true })).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 1, name: "Current Workout" })).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Finish Workout" })).toHaveCount(1);
    const minimize = page.getByRole("link", { name: "Minimize workout" });
    const box = (await minimize.boundingBox())!;
    expect(box.y).toBeLessThan(phone.height / 8);
    expect(box.width).toBeGreaterThanOrEqual(44);

    // Minimize leaves without ending it: Home has the workout to resume, and the dock is back.
    await minimize.click();
    await expect(page).toHaveURL(/\/home/);
    await expect(page.getByRole("link", { name: "Resume workout" })).toBeVisible();
    await expect(dock).toBeVisible();
    await expect(dock.getByRole("link")).toHaveCount(5);

    // Resume goes back to the focus screen, and a reload on it has no dock either (the server and browser agree).
    await page.getByRole("link", { name: "Resume workout" }).click();
    await expect(page.getByRole("button", { name: "Finish Workout" })).toBeVisible();
    await expect(dock).toBeHidden();
    await page.reload();
    await expect(page.getByRole("button", { name: "Finish Workout" })).toBeVisible();
    await expect(dock).toBeHidden();
    // The clock ticks once the page has hydrated, and only then does Finish do anything.
    await expect(page.getByRole("timer", { name: "Workout time" })).not.toHaveText("0:00");

    // Finishing ends the focus: the empty state has the dock again.
    await page.getByRole("button", { name: "Finish Workout" }).click();
    await expect(page.getByText("No active workout. Ready to start?")).toBeVisible();
    await expect(dock).toBeVisible();
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
    await expectNoSidewaysScroll(page);

    // The completed workouts are a list on a phone, not the wide table: a row each, inside the window, grouped by week.
    await expect(page.getByRole("table")).toHaveCount(0);
    await expect(page.getByRole("columnheader")).toHaveCount(0);
    const journal = page.getByRole("region", { name: /^(This week|Last week|\w{3} \d+ – )/ }).first();
    const rows = journal.getByRole("listitem");
    await expect(rows.first()).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 3, name: /^(This week|Last week|[A-Z][a-z]{2} \d+ – )/ }).first(),
    ).toBeVisible();
    const first = (await rows.first().boundingBox())!;
    expect(first.x).toBeGreaterThanOrEqual(0);
    expect(first.x + first.width).toBeLessThanOrEqual(phone.width);
    expect(first.height).toBeGreaterThanOrEqual(44);
    await expect(rows.first()).toContainText("sets");
    await expectNoSidewaysScroll(page);

    // Tap a row to open its sets.
    await rows.first().getByRole("button", { name: "Show the sets of this workout" }).click();
    await expect(rows.first().getByRole("group", { name: "Sets of this workout" })).toBeVisible();
    await expect(rows.first().getByRole("button", { name: "Repeat this workout" })).toBeVisible();
    await expectNoSidewaysScroll(page);

    // Select turns on the checkboxes and a bar to delete the chosen ones.
    await expect(page.getByRole("checkbox", { name: "Select workout" })).toHaveCount(0);
    await page.getByRole("button", { name: "Select", exact: true }).click();
    const boxes = page.getByRole("checkbox", { name: "Select workout" });
    await expect(boxes.first()).toBeAttached();
    expect(await boxes.count()).toBe(5);
    await boxes.first().check();
    const del = page.getByRole("button", { name: "Delete Selected (1)" });
    await expect(del).toBeVisible();
    const delBox = (await del.boundingBox())!;
    expect(delBox.x + delBox.width).toBeLessThanOrEqual(phone.width);
    expect(delBox.y + delBox.height).toBeLessThanOrEqual(phone.height);
    await del.click();
    await expect(page.getByRole("checkbox", { name: "Select workout" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Select", exact: true })).toBeVisible();
    await expect(page.locator("li").filter({ hasText: /sets · / })).toHaveCount(4);
  });

  test("should have a dock of five, with the workout raised in the middle", async ({ page }) => {
    const dock = page.getByRole("navigation", { name: "Main" });
    await expect(dock.getByRole("link")).toHaveCount(5);
    const names = ["Home", "Library", "Current Workout", "Workout History", "Body Weight"];
    const boxes = [];
    for (const name of names) {
      const link = dock.getByRole("link", { name, exact: true });
      await expect(link).toBeVisible();
      boxes.push((await link.boundingBox())!);
    }
    // Left to right in that order, inside the window, at the bottom of it.
    for (let i = 1; i < boxes.length; i++) expect(boxes[i].x).toBeGreaterThan(boxes[i - 1].x);
    for (const box of boxes) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(phone.width);
      expect(box.y + box.height).toBeLessThanOrEqual(phone.height);
      expect(box.y).toBeGreaterThan(phone.height / 2);
    }
    // The middle one is the workout, and no log out is in the dock.
    const center = boxes[2].x + boxes[2].width / 2;
    expect(Math.abs(center - phone.width / 2)).toBeLessThan(2);
    await expect(page.getByRole("button", { name: "Log out" })).toHaveCount(0);
    // The sidebar's names are not in a phone's page.
    await expect(page.getByRole("link", { name: "Workout Library", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Movements", exact: true })).toHaveCount(0);
  });

  test("should reach Movements and the Workout Library through Library, and light it for both", async ({ page }) => {
    const library = page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Library", exact: true });
    await expect(library).not.toHaveAttribute("aria-current", "page");

    await goTo(page, "Movements");
    await expect(library).toHaveAttribute("aria-current", "page");
    const switchLinks = page.getByRole("navigation", { name: "Library" }).getByRole("link");
    await expect(switchLinks).toHaveText(["Workouts", "Movements"]);
    await expect(switchLinks.nth(1)).toHaveAttribute("aria-current", "page");
    await expect(switchLinks.nth(0)).not.toHaveAttribute("aria-current", "page");

    await goTo(page, "Workout Library");
    await expect(library).toHaveAttribute("aria-current", "page");
    await expect(switchLinks.nth(0)).toHaveAttribute("aria-current", "page");
    await expectNoSidewaysScroll(page);

    // The switch is only for a phone: it is not on the other pages.
    await goTo(page, "Body Weight");
    await expect(library).not.toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("navigation", { name: "Library" })).toHaveCount(0);
  });

  test("should open the Account page from the menu on Home, and fit it with the deletion confirmation open", async ({
    page,
  }) => {
    // The dock has five and no room for Account: it is in the round account menu on Home, next to Log out.
    await goTo(page, "Account");
    await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link")).toHaveCount(5);
    await page.getByRole("button", { name: "Delete account" }).click();
    await expect(page.getByRole("group", { name: "Confirm account deletion" })).toBeVisible();
    await expectNoSidewaysScroll(page);
  });

  test("should reach every page from the dock, and log out from the account menu on Home", async ({ page }) => {
    for (const section of ["Workout History", "Movements", "Body Weight", "Current Workout", "Home"] as const) {
      await goTo(page, section);
    }

    // Log out is not in the dock. It is in the menu of the round button at the top right of Home.
    await expect(page.getByRole("button", { name: "Log out" })).toHaveCount(0);
    const account = page.getByRole("button", { name: "Account" });
    const accountBox = await account.boundingBox();
    expect(accountBox!.y).toBeLessThan(phone.height / 4);
    expect(accountBox!.x + accountBox!.width).toBeLessThanOrEqual(phone.width);
    expect(accountBox!.x).toBeGreaterThan(phone.width / 2);
    await account.click();

    const logOut = page.getByRole("button", { name: "Log out" });
    const box = await logOut.boundingBox();
    expect(box!.x + box!.width).toBeLessThanOrEqual(phone.width);
    await logOut.click();

    await expect(page).toHaveURL(/\/sign-in/);
    expect((await page.context().cookies()).find((c) => c.name === "session")).toBeUndefined();
  });

  test("should fit the filters of the movements in a sheet, and show how many are on", async ({ page }) => {
    await goTo(page, "Movements");
    // The list is on the first screen: the filters are behind one button.
    const first = await page.getByRole("list", { name: "Movements" }).getByRole("listitem").first().boundingBox();
    expect(first!.y).toBeLessThan(phone.height / 2);
    await expect(page.getByRole("combobox", { name: "Filter by equipment" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Filters" })).toBeVisible();

    await page.getByRole("button", { name: "Filters" }).click();
    const sheet = page.getByRole("dialog", { name: "Filters" });
    await sheet.getByLabel("Filter by equipment").selectOption({ label: "Kettlebell" });
    await sheet.getByRole("button", { name: /^Body wt/ }).click();
    await expect(sheet.getByRole("button", { name: /^Show \d+ movements?$/ })).toBeVisible();
    await sheet.getByRole("button", { name: /^Show \d+ movements?$/ }).click();
    await expect(sheet).toHaveCount(0);

    // Two filters are on, and the button says so.
    await expect(page.getByRole("button", { name: /^Filters/ })).toContainText("2");
    await expect(page.getByText("Nothing matches")).toBeVisible();
    await page.getByRole("button", { name: /^Filters/ }).click();
    await page.getByRole("dialog", { name: "Filters" }).getByRole("button", { name: "Clear" }).click();
    await expect(page.getByRole("dialog", { name: "Filters" }).getByLabel("Filter by equipment")).toHaveValue("");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: /^Filters/ })).not.toContainText("2");
    await expectNoSidewaysScroll(page);
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
