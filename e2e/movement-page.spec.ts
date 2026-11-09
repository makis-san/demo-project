import { test, expect, newTestUser, signUp } from "./fixtures";
import { getDb } from "./db";
import { addMovement, addSet, goTo, movementRow, startWorkout } from "./helpers";

async function openMovement(page: import("@playwright/test").Page, name: string) {
  await goTo(page, "Movements");
  await movementRow(page, name).getByRole("link").click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
}

test.describe("Movement page", () => {
  test("should animate the movement, change the phase and light the primary muscles", async ({ page }) => {
    await openMovement(page, "Back Squat");

    const phase = page.getByTestId("figure-phase");
    await expect(page.getByRole("img", { name: "Side view of Back Squat" })).toBeVisible();
    // It starts in set up, then lowers, then lifts: the label follows the rep.
    const seen = new Set<string>();
    await expect
      .poll(
        async () => {
          seen.add((await phase.getAttribute("data-phase")) ?? "");
          return [...seen].filter((k) => k === "ecc" || k === "conc").length;
        },
        { timeout: 10_000 },
      )
      .toBe(2);
    expect(await phase.innerText()).toMatch(/Set up|Lowering|Pause|Lifting|Reset/);

    // The squat's primary muscles are marked active on the figure, and the ones it does not use are not.
    const figure = page.getByRole("img", { name: "Side view of Back Squat" });
    for (const muscle of ["quads", "glutes"]) {
      await expect(
        figure.locator(`[data-muscle='${muscle}'][data-primary='true'][data-far='0']`).first(),
      ).toHaveAttribute("data-active", "true");
    }
    await expect(figure.locator("[data-muscle='biceps']").first()).toHaveAttribute("data-active", "false");
  });

  test("should show the muscles of the movement on the body map and in the lists", async ({ page }) => {
    await openMovement(page, "Bench Press");

    await expect(page.getByRole("list", { name: "Primary muscles" })).toHaveText("Chest");
    await expect(page.getByRole("list", { name: "Secondary muscles" })).toHaveText(/Shoulders\s*Triceps/);
    const map = page.getByRole("img", { name: /^Muscles worked by Bench Press, front$/ });
    await expect(map.locator("[data-muscle='chest']")).toHaveAttribute("data-role", "primary");
    await expect(map.locator("[data-muscle='shoulders']")).toHaveAttribute("data-role", "secondary");
    await expect(map.locator("[data-muscle='quads']")).not.toHaveAttribute("data-role", /.+/);
  });

  test("should highlight the step that matches the animation", async ({ page }) => {
    await openMovement(page, "Deadlift");
    const steps = page.locator("ol > li[data-step]");
    await expect(steps).toHaveCount(3);

    // Step 2 is lifting and step 3 is lowering, so both show up in turn within a rep.
    const lit = new Set<string>();
    await expect
      .poll(
        async () => {
          const on = await steps.evaluateAll((els) => els.findIndex((el) => el.getAttribute("data-on") === "true"));
          lit.add(String(on));
          return lit.size;
        },
        { timeout: 10_000 },
      )
      .toBeGreaterThanOrEqual(3);
  });

  test("should pause, scrub and change speed", async ({ page }) => {
    await openMovement(page, "Pull-Up");
    const phase = page.getByTestId("figure-phase");

    await page.getByRole("button", { name: "Pause" }).click();
    await expect(page.getByRole("button", { name: "Play" })).toBeVisible();
    const frozen = await phase.getAttribute("data-phase");
    await page.waitForTimeout(1200);
    await expect(phase).toHaveAttribute("data-phase", frozen!);

    // Scrubbing to the middle of the rep moves the figure to the lifting phase.
    await page.getByLabel("Position in the rep").fill("300");
    await expect(phase).toHaveAttribute("data-phase", "conc");
    await page.getByRole("button", { name: "0.5×" }).click();
    await expect(page.getByRole("button", { name: "0.5×" })).toHaveAttribute("aria-pressed", "true");
  });

  test("should name the joint angles and keep them changing with the pose", async ({ page }) => {
    await openMovement(page, "Back Squat");
    await page.getByRole("button", { name: "Pause" }).click();
    const knee = page.locator("[data-angle='knee'] b");

    await page.getByLabel("Position in the rep").fill("0");
    const standing = parseInt((await knee.textContent())!);
    await page.getByLabel("Position in the rep").fill("450");
    const deep = parseInt((await knee.textContent())!);
    expect(standing).toBeGreaterThan(160);
    expect(deep).toBeLessThan(100);
  });

  test("should toggle the bar path and the range of motion", async ({ page }) => {
    await openMovement(page, "Bench Press");
    const trail = page.locator("[data-eq='trail']");
    const range = page.locator("[data-eq='range']");
    await expect(trail).toBeVisible();
    await expect(range).toBeVisible();

    await page.getByRole("button", { name: "Bar path" }).click();
    await page.getByRole("button", { name: "Range of motion" }).click();
    await expect(trail).toBeHidden();
    await expect(range).toBeHidden();
  });

  test("should draw the first pose on the server, before any script runs", async ({ page, browser }) => {
    // Signed in with scripts on (the page fixture), then the page is read with scripts off.
    const movement = await getDb().movement.findFirstOrThrow({ where: { userId: null, name: "Back Squat" } });
    const state = await page.context().storageState();

    const noScripts = await browser.newContext({ javaScriptEnabled: false, storageState: state });
    const bare = await noScripts.newPage();
    await bare.goto(`/movements/${movement.id}`);

    await expect(bare.getByRole("img", { name: "Side view of Back Squat" })).toBeVisible();
    await expect(bare.getByTestId("figure-phase")).toHaveAttribute("data-phase", "setup");
    await expect(bare.getByTestId("figure-phase")).toContainText("Set up");
    // The pose is already in the markup: every body part has its place.
    expect(await bare.locator("[data-part]").count()).toBe(12);
    expect(await bare.locator("[data-part]").first().getAttribute("transform")).toMatch(/translate\(.+\) rotate\(.+\)/);
    await expect(bare.locator("ol > li[data-step]")).toHaveCount(3);
    await noScripts.close();
  });

  test.describe("with reduced motion", () => {
    test.use({ reducedMotion: "reduce" });

    test("should start paused", async ({ page }) => {
      await openMovement(page, "Back Squat");

      await expect(page.getByRole("button", { name: "Play" })).toBeVisible();
      await page.waitForTimeout(1500);
      await expect(page.getByTestId("figure-phase")).toHaveAttribute("data-phase", "setup");
      // It can still be played.
      await page.getByRole("button", { name: "Play" }).click();
      await expect(page.getByTestId("figure-phase")).not.toHaveAttribute("data-phase", "setup", { timeout: 5000 });
    });
  });

  test.describe("on a phone", () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test("should fit the window with no sideways scroll", async ({ page }) => {
      await openMovement(page, "Overhead Press");

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      expect(overflow).toBe(false);
      const stage = await page.locator(".figure-stage").boundingBox();
      expect(stage!.x).toBeGreaterThanOrEqual(0);
      expect(stage!.x + stage!.width).toBeLessThanOrEqual(390);
    });
  });

  test("should show the body map and steps for a built-in without an animation", async ({ page }) => {
    await openMovement(page, "Lateral Raise");

    await expect(page.getByText("There is no animation for this movement yet.")).toBeVisible();
    await expect(page.getByTestId("figure-phase")).toHaveCount(0);
    await expect(page.locator("ol > li[data-step]")).toHaveCount(3);
    await expect(page.getByRole("list", { name: "Primary muscles" })).toHaveText("Shoulders");
  });

  test("should explain that a custom movement has no guide", async ({ page }) => {
    await addMovement(page, "Home Made Lift");
    await movementRow(page, "Home Made Lift").getByRole("link").click();

    await expect(page.getByText("This is a movement you created")).toBeVisible();
    await expect(page.locator("ol > li[data-step]")).toHaveCount(0);
  });

  test("should show the user's last top set and best", async ({ page }) => {
    await goTo(page, "Current Workout");
    await startWorkout(page);
    await addSet(page, { movement: "Bench Press", weight: 100, reps: 5 });
    await addSet(page, { movement: "Bench Press", weight: 110, reps: 3 });
    await page.getByRole("button", { name: "Finish Workout" }).click();
    await expect(page.getByText("No active workout. Ready to start?")).toBeVisible();

    await openMovement(page, "Bench Press");
    await expect(page.getByText("Last top set").locator("..")).toContainText("110");
    await expect(page.getByText("Best", { exact: true }).locator("..")).toContainText("110");
    await openMovement(page, "Back Squat");
    await expect(page.getByText("You haven't logged this movement yet.")).toBeVisible();
  });

  test("should not open another user's movement", async ({ page, browser }) => {
    const otherContext = await browser.newContext();
    const otherPage = await otherContext.newPage();
    const other = newTestUser();
    await signUp(otherPage, other);
    await addMovement(otherPage, "Secret Lift");
    await otherContext.close();
    const foreign = await getDb().movement.findFirstOrThrow({ where: { user: { email: other.email } } });

    await page.goto(`/movements/${foreign.id}`);

    await expect(page.getByText("That movement doesn't exist.")).toBeVisible();
    await expect(page.getByText("Secret Lift")).toHaveCount(0);
  });
});
