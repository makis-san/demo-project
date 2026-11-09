import { test, expect, gotoApp } from "./fixtures";
import {
  addMovement,
  addSet,
  completeWorkout,
  createWorkout,
  goTo,
  pressStart,
  selectMovement,
  setRows,
  startWorkout,
} from "./helpers";

const sheetOf = (page: import("@playwright/test").Page) => page.getByRole("dialog", { name: "Choose a movement" });
const openSheet = (page: import("@playwright/test").Page) =>
  page.getByRole("button", { name: "Add movement", exact: true }).click();

test.describe("Current workout: adding a movement", () => {
  test.beforeEach(async ({ page }) => {
    await startWorkout(page);
  });

  test("should have no movement picker on the page, and no set form until a movement is chosen", async ({ page }) => {
    await expect(page.getByRole("combobox")).toHaveCount(0);
    await expect(page.getByRole("group", { name: "Selected movement" })).toHaveCount(0);
    await expect(page.getByLabel("Weight")).toHaveCount(0);
    // One small round icon button to add a movement: a 44px tap target, with no text.
    const add = page.getByRole("button", { name: "Add movement", exact: true });
    await expect(add).toBeVisible();
    await expect(add).toHaveText("");
    const box = await add.boundingBox();
    // Below 45 rather than exactly 44: the box is measured with subpixel rounding.
    expect(box!.height).toBeLessThan(45);
    expect(box!.width).toBeLessThan(45);
  });

  test("should show the set form for the movement picked in the sheet", async ({ page }) => {
    await selectMovement(page, "Bench Press");

    await expect(page.getByRole("group", { name: "Selected movement" })).toContainText("Bench Press");
    await expect(page.getByLabel("Weight", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Reps", { exact: true })).toBeVisible();
    // The sheet is gone and the page can scroll again.
    await expect(sheetOf(page)).toHaveCount(0);
    expect(await page.evaluate(() => document.body.style.overflow)).not.toBe("hidden");
  });

  test("should pick another movement and switch back with the chips of this session", async ({ page }) => {
    await addSet(page, { movement: "Bench Press", weight: 100, reps: 5 });
    await selectMovement(page, "Back Squat");
    await page.getByLabel("Weight", { exact: true }).fill("150");
    await page.getByLabel("Reps", { exact: true }).fill("3");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(setRows(page)).toHaveCount(2);

    // One chip per movement used, and a tap on one brings that movement and its last set back.
    await page.getByRole("button", { name: "Bench Press 5 × 100 lbs" }).click();
    await expect(page.getByRole("group", { name: "Selected movement" })).toContainText("Bench Press");
    await expect(page.getByLabel("Weight", { exact: true })).toHaveValue("100");
    await expect(page.getByLabel("Reps", { exact: true })).toHaveValue("5");
  });

  test("should still show the chips of this session when no movement is selected", async ({ page }) => {
    await addSet(page, { movement: "Bench Press", weight: 100, reps: 5 });
    await page.reload();

    await expect(page.getByRole("group", { name: "Selected movement" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Bench Press 5 × 100 lbs" })).toBeVisible();
  });

  test("should show body-part images on the cards of the sheet, and the user's own movements", async ({ page }) => {
    await addMovement(page, "Cable Y-Raise");
    await goTo(page, "Current Workout");
    await openSheet(page);

    const sheet = sheetOf(page);
    await sheet.getByRole("searchbox", { name: "Search movements" }).fill("bench press");
    const card = sheet
      .getByRole("listitem")
      .filter({ has: page.getByRole("button", { name: "Bench Press", exact: true }) });
    await expect(card.locator("svg.body-thumb")).toBeVisible();
    await sheet.getByRole("searchbox", { name: "Search movements" }).fill("y-raise");
    await expect(sheet.getByRole("listitem")).toHaveCount(1);
    await expect(sheet.getByRole("listitem")).toContainText("Yours");
    await sheet.getByRole("searchbox", { name: "Search movements" }).fill("qqqqqq");
    await expect(sheet.getByText("No movement matches “qqqqqq”.")).toBeVisible();
  });

  test("should close with Escape, the close button, or a tap on the page behind it", async ({ page }) => {
    await openSheet(page);
    await expect(sheetOf(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(sheetOf(page)).toHaveCount(0);

    await openSheet(page);
    await sheetOf(page).getByRole("button", { name: "Close", exact: true }).click();
    await expect(sheetOf(page)).toHaveCount(0);

    await openSheet(page);
    await page.mouse.click(4, 4);
    await expect(sheetOf(page)).toHaveCount(0);
    // Nothing was picked by closing it.
    await expect(page.getByRole("group", { name: "Selected movement" })).toHaveCount(0);
  });

  test("should load a page of movements at a time, and the next when the end is reached", async ({ page }) => {
    const pages: number[] = [];
    page.on("response", async (response) => {
      if (!response.url().includes("/_serverFn/") || response.request().method() !== "GET") return;
      const count = ((await response.text().catch(() => "")).match(/"isBuiltIn"/g) ?? []).length;
      if (count > 0) pages.push(count);
    });
    // Nothing is loaded until the sheet is opened, and then only the first page.
    expect(Math.max(0, ...pages)).toBeLessThan(90);
    await openSheet(page);
    const cards = sheetOf(page).getByRole("list", { name: "Movements" }).getByRole("listitem");
    await expect(cards).toHaveCount(20);
    expect(Math.max(0, ...pages)).toBeLessThanOrEqual(21);

    const list = sheetOf(page).getByRole("list", { name: "Movements" }).locator("xpath=..");
    await expect
      .poll(
        async () => {
          await list.evaluate((el) => el.scrollTo(0, el.scrollHeight));
          return cards.count();
        },
        { timeout: 15_000 },
      )
      .toBeGreaterThanOrEqual(90);
    const names = await cards.evaluateAll((els) => els.map((el) => el.querySelector("button")!.textContent));
    expect(new Set(names).size).toBe(names.length);
  });

  test.describe("on a desktop", () => {
    test.use({ viewport: { width: 1280, height: 800 } });

    test("should open as a modal in the middle of the window", async ({ page }) => {
      await openSheet(page);

      const box = await sheetOf(page).boundingBox();
      const centreX = box!.x + box!.width / 2;
      const centreY = box!.y + box!.height / 2;
      expect(Math.abs(centreX - 640)).toBeLessThan(4);
      expect(Math.abs(centreY - 400)).toBeLessThan(60);
      // A modal, not a full-width sheet, and clear of the bottom edge.
      expect(box!.width).toBeLessThan(800);
      expect(box!.y + box!.height).toBeLessThan(800);
    });
  });

  test.describe("on a phone", () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test("should rise from the bottom as a sheet that fills the width", async ({ page }) => {
      await openSheet(page);

      const sheet = sheetOf(page);
      await expect(sheet).toBeVisible();
      // Wait for the slide-up to finish, then it rests on the bottom edge and spans the window.
      await expect
        .poll(async () => Math.round((await sheet.boundingBox())!.y + (await sheet.boundingBox())!.height))
        .toBe(844);
      const box = (await sheet.boundingBox())!;
      expect(box.x).toBeCloseTo(0, 0);
      expect(Math.round(box.width)).toBe(390);
      expect(box.y).toBeGreaterThan(40);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

      await sheet.getByRole("searchbox", { name: "Search movements" }).fill("bench press");
      await sheet.getByRole("button", { name: "Bench Press", exact: true }).click();
      await expect(page.getByRole("group", { name: "Selected movement" })).toContainText("Bench Press");
    });
  });

  test("should keep a planned workout working, with extra movements added to it", async ({ page }) => {
    await page.getByRole("button", { name: "Finish Workout" }).click();
    await createWorkout(page, "Push day", ["Overhead Press"]);
    await page.getByRole("link", { name: "Start Push day" }).click();
    await pressStart(page);

    await page.getByRole("button", { name: "Log planned Overhead Press set: 10 × no weight" }).first().click();
    await expect(setRows(page)).toHaveCount(1);
    await selectMovement(page, "Lateral Raise");
    await page.getByLabel("Weight", { exact: true }).fill("15");
    await page.getByLabel("Reps", { exact: true }).fill("12");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(setRows(page)).toHaveCount(2);
    await expect(page.getByText("1 of 3 logged", { exact: true })).toBeVisible();
  });
});

test.describe("Starting a workout: the countdown", () => {
  test("should count 3, 2, 1, GO and only then start the workout", async ({ page, user }) => {
    const { getDb } = await import("./db");
    await goTo(page, "Current Workout");
    await page.getByRole("link", { name: "Empty workout" }).click();
    await page.getByRole("button", { name: "Start workout" }).click();

    const countdown = page.getByTestId("countdown");
    await expect(countdown).toHaveAttribute("data-step", "3");
    await expect(countdown).toContainText("3");
    // The page behind it is covered, and the button cannot be pressed twice.
    await expect(page.getByRole("button", { name: "Start workout" })).toBeDisabled();
    for (const step of ["2", "1", "GO!"]) await expect(countdown).toHaveAttribute("data-step", step);
    await expect(page).toHaveURL(/\/current-workout/, { timeout: 15_000 });
    expect(await getDb().workout.count({ where: { user: { email: user.email }, completedAt: null } })).toBe(1);
  });

  test("should start the clock at GO, not when the button was pressed", async ({ page, user }) => {
    const { getDb } = await import("./db");
    await goTo(page, "Current Workout");
    await page.getByRole("link", { name: "Empty workout" }).click();
    const pressed = Date.now();
    await page.getByRole("button", { name: "Start workout" }).click();
    await expect(page).toHaveURL(/\/current-workout/, { timeout: 15_000 });

    const workout = await getDb().workout.findFirstOrThrow({ where: { user: { email: user.email } } });
    // The countdown is 3 x 0.75 s and GO is 0.55 s, so the workout starts about 2.8 s after the press.
    expect(workout.startedAt.getTime() - pressed).toBeGreaterThan(2000);
  });

  test("should be cancelled with the Cancel button, leaving nothing behind", async ({ page, user }) => {
    const { getDb } = await import("./db");
    await goTo(page, "Current Workout");
    await page.getByRole("link", { name: "Empty workout" }).click();
    await page.getByRole("button", { name: "Start workout" }).click();
    await expect(page.getByTestId("countdown")).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();

    await expect(page.getByTestId("countdown")).toHaveCount(0);
    // Past the time the countdown would have ended: still no workout.
    await page.waitForTimeout(3500);
    await expect(page).toHaveURL(/\/start-workout/);
    expect(await getDb().workout.count({ where: { user: { email: user.email } } })).toBe(0);
    await expect(page.getByRole("button", { name: "Start workout" })).toBeEnabled();
  });

  test("should be cancelled with Escape", async ({ page }) => {
    await goTo(page, "Current Workout");
    await page.getByRole("link", { name: "Empty workout" }).click();
    await page.getByRole("button", { name: "Start workout" }).click();
    await expect(page.getByTestId("countdown")).toBeVisible();
    await page.keyboard.press("Escape");

    await expect(page.getByTestId("countdown")).toHaveCount(0);
    await page.waitForTimeout(3500);
    await expect(page).toHaveURL(/\/start-workout/);
  });

  test("should also run before a workout from the library", async ({ page }) => {
    await createWorkout(page, "Push day", ["Bench Press"]);
    await page.getByRole("link", { name: "Start Push day" }).click();
    await page.getByRole("button", { name: "Start workout" }).click();

    await expect(page.getByTestId("countdown")).toBeVisible();
    await expect(page).toHaveURL(/\/current-workout/, { timeout: 15_000 });
    await expect(page.getByText("Planned from Push day")).toBeVisible();
  });

  test("should fill the phone's screen", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await goTo(page, "Current Workout");
    await page.getByRole("link", { name: "Empty workout" }).click();
    await page.getByRole("button", { name: "Start workout" }).click();

    const box = (await page.getByTestId("countdown").boundingBox())!;
    expect([Math.round(box.width), Math.round(box.height)]).toEqual([390, 844]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test.describe("with reduced motion", () => {
    test.use({ reducedMotion: "reduce" });

    test("should start at once, with no countdown", async ({ page }) => {
      await goTo(page, "Current Workout");
      await page.getByRole("link", { name: "Empty workout" }).click();
      await page.getByRole("button", { name: "Start workout" }).click();

      await expect(page.getByRole("button", { name: "Finish Workout" })).toBeVisible({ timeout: 3000 });
      await expect(page.getByTestId("countdown")).toHaveCount(0);
    });
  });
});

test.describe("Ending a workout: the confetti", () => {
  test("should burst when the workout is completed, and take itself away", async ({ page }) => {
    await startWorkout(page);
    await addSet(page, { movement: "Bench Press", weight: 100, reps: 5 });
    await expect(page.getByTestId("confetti")).toHaveCount(0);

    await page.getByRole("button", { name: "Finish Workout" }).click();

    const confetti = page.getByTestId("confetti");
    await expect(confetti).toBeVisible();
    await expect(page.getByText("Session complete")).toBeVisible();
    // It is drawn: pieces are on the canvas shortly after it starts.
    await expect
      .poll(() =>
        confetti.evaluate((canvas: HTMLCanvasElement) => {
          const data = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
          for (let i = 3; i < data.length; i += 4 * 97) if (data[i] > 0) return true;
          return false;
        }),
      )
      .toBe(true);
    // It never takes a tap: the page under it still works.
    expect(await confetti.evaluate((el) => getComputedStyle(el).pointerEvents)).toBe("none");
    await expect(page.getByRole("link", { name: "See it in your history" })).toBeEnabled();
    // And it is gone after a few seconds.
    await expect(confetti).toHaveCount(0, { timeout: 8000 });
    await expect(page.getByText("Session complete")).toBeVisible();
  });

  test("should burst again for the next workout", async ({ page }) => {
    await completeWorkout(page, [{ movement: "Bench Press", weight: 100, reps: 5 }]);
    await expect(page.getByTestId("confetti")).toBeVisible();
    await expect(page.getByTestId("confetti")).toHaveCount(0, { timeout: 8000 });

    await completeWorkout(page, [{ movement: "Bench Press", weight: 105, reps: 5 }]);
    await expect(page.getByTestId("confetti")).toBeVisible();
  });

  test("should not burst when completing is refused", async ({ page }) => {
    await startWorkout(page);
    const otherTab = await page.context().newPage();
    await gotoApp(otherTab, "/current-workout");
    await otherTab.getByRole("button", { name: "Finish Workout" }).click();
    await expect(otherTab.getByText("No active workout. Ready to start?")).toBeVisible();
    await otherTab.close();

    await page.getByRole("button", { name: "Finish Workout" }).click();
    await expect(page.locator(".Toastify__toast")).toContainText("No active workout");
    await expect(page.getByTestId("confetti")).toHaveCount(0);
  });

  test.describe("with reduced motion", () => {
    test("should not burst", async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await startWorkout(page);
      await addSet(page, { movement: "Bench Press", weight: 100, reps: 5 });
      await page.getByRole("button", { name: "Finish Workout" }).click();

      await expect(page.getByText("Session complete")).toBeVisible();
      await expect(page.getByTestId("confetti")).toHaveCount(0);
    });
  });
});
