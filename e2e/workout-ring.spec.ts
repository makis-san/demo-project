import type { Page } from "@playwright/test";
import { test, expect, gotoApp } from "./fixtures";
import { getDb } from "./db";
import { createWorkout, pressStart, setRows, startWorkout } from "./helpers";

const ring = (page: Page) => page.getByRole("region", { name: "Workout progress" });
const clock = (page: Page) => page.getByRole("timer", { name: "Workout time" });
const ringMovement = (page: Page) => page.getByTestId("ring-movement");
const section = (page: Page, name: string) =>
  page.getByRole("list", { name: "Workout timeline" }).locator(`[data-section="${name}"]`);

async function startPlanned(page: Page) {
  await createWorkout(page, "Push day", ["Bench Press", "Overhead Press"]);
  await page.getByRole("link", { name: "Start Push day" }).click();
  await pressStart(page);
}

/** The stored timeline of the user's open workout, once the browser has sent one that matches `check`. */
async function serverTimeline(email: string, check: (timeline: any) => boolean) {
  let found: any = null;
  await expect
    .poll(async () => {
      const workout = await getDb().workout.findFirst({ where: { user: { email }, completedAt: null } });
      found = workout?.timeline ?? null;
      return !!found && check(found);
    })
    .toBe(true);
  return found;
}

test.describe("Workout ring", () => {
  test("should start on the plan's first movement, with the rest of the plan in the legend only", async ({ page }) => {
    await startPlanned(page);

    await expect(ring(page)).toBeVisible();
    await expect(clock(page)).toHaveText(/^0:0\d$/);
    await expect(ringMovement(page)).toHaveText("Bench Press");
    await expect(ring(page).getByText("Set 1 of 3")).toBeVisible();
    // Three sets of ten with a 60 s rest is about 5 minutes per movement.
    await expect(ring(page).getByText(/^of about \d+ min$/)).toBeVisible();
    await expect(section(page, "Bench Press")).toHaveAttribute("data-state", "current");
    await expect(section(page, "Overhead Press")).toHaveAttribute("data-state", "upcoming");
    await expect(section(page, "Overhead Press")).toContainText(/~\d+ min/);
    // The ring only shows what has begun: nothing of Overhead Press is on it yet. The time still expected is empty
    // track, not drawn.
    await expect(ring(page).locator('[data-movement="Overhead Press"]')).toHaveCount(0);
    await expect(ring(page).locator('[data-arc="ghost"]')).toHaveCount(0);

    // The header no longer has its own Complete button: Finish is on the ring.
    await expect(page.getByRole("button", { name: "Finish Workout" })).toHaveCount(1);
  });

  test("should go to the next planned movement with Next, and close the section before it", async ({ page }) => {
    await startPlanned(page);

    await page.getByRole("button", { name: "Next movement: Overhead Press" }).click();

    await expect(ringMovement(page)).toHaveText("Overhead Press");
    await expect(section(page, "Overhead Press")).toHaveAttribute("data-state", "current");
    await expect(section(page, "Bench Press")).toHaveAttribute("data-state", "done");
    // The set form is ready for the new movement.
    await expect(page.getByRole("group", { name: "Selected movement" })).toContainText("Overhead Press");
    // Bench Press still has sets to do, but it was left: Next does not go back round to it.
    await expect(page.getByRole("button", { name: "Next movement: end of plan" })).toBeVisible();
  });

  test("should keep every movement on the ring when Next movement is tapped quickly", async ({ page }) => {
    await createWorkout(page, "Full body", ["Bench Press", "Overhead Press", "Back Squat", "Barbell Row"]);
    await page.getByRole("link", { name: "Start Full body" }).click();
    await pressStart(page);

    // Straight away, a tap at a time: each movement left keeps its arc, however short, and Next walks on through the
    // plan, never back to the one it just left.
    await page.getByRole("button", { name: "Next movement: Overhead Press" }).click();
    await expect(ring(page).locator("[data-arc]")).toHaveCount(2);
    await page.getByRole("button", { name: "Next movement: Back Squat" }).click();
    await page.getByRole("button", { name: "Next movement: Barbell Row" }).click();
    await expect(ringMovement(page)).toHaveText("Barbell Row");
    await expect(page.getByRole("button", { name: "Next movement: end of plan" })).toBeVisible();
    await expect(ring(page).locator("[data-arc]")).toHaveCount(4);
    for (const name of ["Bench Press", "Overhead Press", "Back Squat"]) {
      await expect(section(page, name)).toHaveAttribute("data-state", "done");
    }
  });

  test("should walk the plan once with Next movement, then end it on Finish and Add", async ({ page }) => {
    await startPlanned(page);
    await page.getByRole("button", { name: "Next movement: Overhead Press" }).click();
    await expect(ringMovement(page)).toHaveText("Overhead Press");

    // The last planned movement: Next ends the plan, sets skipped or not, and pressing on stops there.
    await page.getByRole("button", { name: "Next movement: end of plan" }).click();
    await expect(ring(page).getByText("Plan complete")).toBeVisible();
    await expect(page.getByRole("button", { name: "Finish Workout" })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Next movement/ })).toHaveCount(0);
    await expect(ring(page).locator("[data-arc]")).toHaveCount(2);

    // A skipped movement can still be done: Add carries the workout on with it.
    await page.getByRole("button", { name: "Add another movement" }).click();
    const sheet = page.getByRole("dialog", { name: "Choose a movement" });
    await sheet.getByRole("searchbox", { name: "Search movements" }).fill("Bench Press");
    await sheet.getByRole("button", { name: "Bench Press", exact: true }).click();
    await expect(ringMovement(page)).toHaveText("Bench Press");
    await expect(page.getByRole("button", { name: "Pause workout" })).toBeVisible();
  });

  test("should burst from the head on Next movement and pop the logged set on Next set, and not with reduced motion", async ({
    page,
  }) => {
    await startPlanned(page);
    const fx = (kind: string) => ring(page).locator(`[data-fx="${kind}"]`);

    // A set logged: its segment throws sparks and a spark runs on to the next set.
    await page.getByRole("button", { name: /^Next set: / }).click();
    await expect(fx("sparks").first()).toBeAttached();
    await expect(fx("comet").first()).toBeAttached();
    // The flourishes clean up after themselves.
    await expect(ring(page).locator("[data-fx]")).toHaveCount(0);

    await page.getByRole("button", { name: "Next movement: Overhead Press" }).click();
    await expect(fx("ripple").first()).toBeAttached();
    await expect(ring(page).locator("[data-fx]")).toHaveCount(0);

    // Back to Bench Press by logging one of its sets from the list, with reduced motion: no flourish.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page
      .getByRole("button", { name: /^Log planned Bench Press set/ })
      .first()
      .click();
    await expect(ringMovement(page)).toHaveText("Bench Press");
    await page.waitForTimeout(300);
    await expect(ring(page).locator("[data-fx]")).toHaveCount(0);
  });

  test("should switch the current movement when a set of another movement is logged", async ({ page }) => {
    await startPlanned(page);
    await page
      .getByRole("button", { name: /^Log planned Overhead Press set/ })
      .first()
      .click();
    await expect(setRows(page)).toHaveCount(1);

    await expect(ringMovement(page)).toHaveText("Overhead Press");
    await expect(ring(page).getByText("Set 2 of 3")).toBeVisible();
  });

  test("should stop the clock while paused, keep the pause after a reload, and sync it to the server", async ({
    page,
    user,
  }) => {
    await startPlanned(page);
    await page.waitForTimeout(1500);

    await page.getByRole("button", { name: "Pause workout" }).click();
    await expect(page.getByRole("button", { name: "Resume workout" })).toBeVisible();
    await expect(ring(page).getByText("Paused", { exact: true })).toBeVisible();
    const frozen = await clock(page).textContent();
    await page.waitForTimeout(2200);
    await expect(clock(page)).toHaveText(frozen!);

    // Saved in the browser first: a reload is still paused, at the same time.
    await page.reload();
    await expect(page.getByRole("button", { name: "Resume workout" })).toBeVisible();
    await expect(clock(page)).toHaveText(frozen!);

    // And on the server: with the browser's copy gone, the page gets it back from there.
    const stored = await serverTimeline(user.email, (t) => t.pauses.length === 1 && t.pauses[0].endedAt === null);
    expect(stored.sections[0].endedAt).toBeNull();
    await page.evaluate(() => localStorage.removeItem("setlist.timeline"));
    await gotoApp(page, "/current-workout");
    await expect(page.getByRole("button", { name: "Resume workout" })).toBeVisible();
    await expect(clock(page)).toHaveText(frozen!);

    await page.getByRole("button", { name: "Resume workout" }).click();
    await expect(page.getByRole("button", { name: "Pause workout" })).toBeVisible();
    await expect(clock(page)).not.toHaveText(frozen!, { timeout: 3000 });
  });

  test("should end a pause when a set is logged", async ({ page }) => {
    await startPlanned(page);
    await page.getByRole("button", { name: "Pause workout" }).click();
    await expect(page.getByRole("button", { name: "Resume workout" })).toBeVisible();

    await page
      .getByRole("button", { name: /^Log planned Bench Press set/ })
      .first()
      .click();

    await expect(setRows(page)).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Pause workout" })).toBeVisible();
  });

  test("should open the movement sheet from Next in a workout without a plan", async ({ page }) => {
    await startWorkout(page);
    await expect(ringMovement(page)).toHaveText("Warm-up");
    // No plan, so no ghost and no expected time.
    await expect(ring(page).getByText(/^of about/)).toHaveCount(0);

    await page.getByRole("button", { name: "Next movement", exact: true }).click();
    const sheet = page.getByRole("dialog", { name: "Choose a movement" });
    await sheet.getByRole("searchbox", { name: "Search movements" }).fill("Back Squat");
    await sheet.getByRole("button", { name: "Back Squat", exact: true }).click();

    await expect(ringMovement(page)).toHaveText("Back Squat");
    await expect(section(page, "Back Squat")).toHaveAttribute("data-state", "current");
  });

  test("should finish the workout with the flag, and keep the closed timeline with it", async ({ page, user }) => {
    await startPlanned(page);
    await page.getByRole("button", { name: "Pause workout" }).click();
    await expect(page.getByRole("button", { name: "Resume workout" })).toBeVisible();
    await page.waitForTimeout(1200);

    await page.getByRole("button", { name: "Finish Workout" }).click();

    await expect(page.getByText("No active workout. Ready to start?")).toBeVisible();
    const workout = await getDb().workout.findFirstOrThrow({ where: { user: { email: user.email } } });
    expect(workout.completedAt).not.toBeNull();
    const timeline = workout.timeline as any;
    // Finish ends the open section and the pause in progress.
    expect(timeline.sections.every((s: any) => s.endedAt !== null)).toBe(true);
    expect(timeline.pauses).toHaveLength(1);
    expect(timeline.pauses[0].endedAt).not.toBeNull();
    // The browser forgets its copy once the workout is complete.
    expect(await page.evaluate(() => localStorage.getItem("setlist.timeline"))).toBeNull();
  });

  test("should log the current movement's planned sets with Next set, then move on instead of adding one", async ({
    page,
  }) => {
    await startPlanned(page);
    const nextSet = page.getByRole("button", { name: /^Next set: / });
    await expect(nextSet).toHaveAccessibleName("Next set: 10 × no weight");

    for (let n = 1; n <= 3; n++) {
      await nextSet.click();
      await expect(setRows(page)).toHaveCount(n);
    }
    await expect(ring(page).getByText("All 3 sets done")).toBeVisible();
    // Every planned Bench Press set is done: the big button moves on instead of logging a fourth, and Next movement
    // glows.
    const upNext = page.getByRole("button", { name: "Up next: Overhead Press" });
    await expect(upNext).toBeVisible();
    await expect(page.getByRole("button", { name: "Next movement: Overhead Press" })).toHaveClass(/next-ready/);

    await upNext.click();
    await expect(ringMovement(page)).toHaveText("Overhead Press");
    await expect(setRows(page)).toHaveCount(3);
    await expect(page.getByRole("button", { name: /^Next set: / })).toHaveAccessibleName("Next set: 10 × no weight");
  });

  test("should move on to the next movement when the rest after its last planned set runs out", async ({ page }) => {
    await startPlanned(page);
    const nextSet = page.getByRole("button", { name: /^Next set: / });
    for (let n = 1; n <= 3; n++) {
      await nextSet.click();
      await expect(setRows(page)).toHaveCount(n);
    }
    await expect(ringMovement(page)).toHaveText("Bench Press");

    // Take the 60 s rest down to nothing: it runs out, and the workout moves on by itself.
    await expect(page.getByText("Resting")).toBeVisible();
    for (let i = 0; i < 4; i++) await page.getByRole("button", { name: "−15s" }).click();
    await expect(ringMovement(page)).toHaveText("Overhead Press");
    await expect(setRows(page)).toHaveCount(3);
  });

  test("should pause and offer only Finish and Add once the plan is done, and resume with an added movement", async ({
    page,
  }) => {
    await createWorkout(page, "Solo", ["Bench Press"]);
    await page.getByRole("link", { name: "Start Solo" }).click();
    await pressStart(page);
    for (let n = 1; n <= 3; n++) {
      await page.getByRole("button", { name: /^Next set: / }).click();
      await expect(setRows(page)).toHaveCount(n);
    }

    // Paused, with the rest timer put away and only Finish and Add left.
    await expect(ring(page).getByText("Plan complete")).toBeVisible();
    await expect(page.getByRole("button", { name: "Finish Workout" })).toBeVisible();
    const add = page.getByRole("button", { name: "Add another movement" });
    await expect(add).toBeVisible();
    for (const name of [/^Next set: /, /^Up next: /, /^Next movement/, /^(Pause|Resume) workout$/]) {
      await expect(page.getByRole("button", { name })).toHaveCount(0);
    }
    await expect(page.getByText("Resting")).toHaveCount(0);
    const frozen = await clock(page).textContent();
    await page.waitForTimeout(1500);
    await expect(clock(page)).toHaveText(frozen!);

    // Adding a movement carries the workout on.
    await add.click();
    const sheet = page.getByRole("dialog", { name: "Choose a movement" });
    await sheet.getByRole("searchbox", { name: "Search movements" }).fill("Back Squat");
    await sheet.getByRole("button", { name: "Back Squat", exact: true }).click();
    await expect(ringMovement(page)).toHaveText("Back Squat");
    await expect(page.getByRole("button", { name: "Pause workout" })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Next set: / })).toBeVisible();
    await expect(clock(page)).not.toHaveText(frozen!);
  });

  test("should ask for a movement, then for the numbers, when Next set has nothing to log", async ({ page }) => {
    await startWorkout(page);
    await page.getByRole("button", { name: "Next set: Pick a movement" }).click();
    const sheet = page.getByRole("dialog", { name: "Choose a movement" });
    await sheet.getByRole("searchbox", { name: "Search movements" }).fill("Back Squat");
    await sheet.getByRole("button", { name: "Back Squat", exact: true }).click();

    await expect(page.getByRole("button", { name: "Next set: Type the numbers" })).toBeVisible();
    await expect(page.getByRole("group", { name: "Selected movement" })).toContainText("Back Squat");
    await page.getByLabel("Weight", { exact: true }).fill("100");
    await page.getByLabel("Reps", { exact: true }).fill("5");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByRole("button", { name: "Next set: Again 5 × 100 lbs" })).toBeVisible();
  });

  test("should show every set on the inner ring: solid when logged, the next one lit, the rest faint", async ({
    page,
  }) => {
    await startPlanned(page);
    const slots = (state: "logged" | "next" | "planned") => ring(page).locator(`[data-slot="${state}"]`);
    await expect(slots("logged")).toHaveCount(0);
    await expect(slots("next")).toHaveCount(1);
    await expect(slots("next")).toHaveAttribute("data-movement", "Bench Press");
    // Only Bench Press's sets: Overhead Press has not begun.
    await expect(slots("planned")).toHaveCount(2);

    await page.getByRole("button", { name: /^Next set: / }).click();

    await expect(slots("logged")).toHaveCount(1);
    await expect(slots("next")).toHaveCount(1);
    await expect(slots("planned")).toHaveCount(1);

    // Starting Overhead Press brings it onto the ring with all three of its sets.
    await page.getByRole("button", { name: "Next movement: Overhead Press" }).click();
    await expect(ring(page).locator('[data-movement="Overhead Press"]')).toHaveCount(3);
    await expect(slots("next")).toHaveAttribute("data-movement", "Overhead Press");
    // Its other two, and the two Bench Press sets still to do.
    await expect(slots("planned")).toHaveCount(4);
  });

  test("should write the movements' names along the ring where they fit", async ({ page }) => {
    await startPlanned(page);
    // At the start Bench Press's arc is too short for its name.
    await expect(ring(page).locator("[data-arc]")).toHaveCount(1);
    await expect(ring(page).locator("textPath")).toHaveCount(0);

    // A couple of minutes on, it has room.
    await page.clock.install();
    await gotoApp(page, "/current-workout");
    await page.clock.fastForward("02:00");
    await expect(ring(page).locator("textPath", { hasText: "BENCH PRESS" })).toHaveCount(1);
    await expect(ring(page).locator("textPath", { hasText: "OVERHEAD PRESS" })).toHaveCount(0);
  });

  test("should draw every section as a pill with a gap to the next, however short", async ({ page }) => {
    await createWorkout(page, "Trio", ["Bench Press", "Overhead Press", "Barbell Row"]);
    await page.getByRole("link", { name: "Start Trio" }).click();
    await pressStart(page);
    // Two quick sections of a moment each, in a plan of about 15 minutes.
    for (const name of ["Overhead Press", "Barbell Row"]) {
      await page.getByRole("button", { name: `Next movement: ${name}` }).click();
    }
    await expect(ring(page).locator("[data-arc]")).toHaveCount(3);

    // Each arc's dash, as [from, to] in percent of the ring, once the arcs have settled.
    await page.waitForTimeout(1200);
    const spans = await ring(page)
      .locator("[data-arc]")
      .evaluateAll((els) =>
        els.map((el) => {
          const style = (el as SVGElement).style;
          const length = parseFloat(style.getPropertyValue("--dash"));
          const from = -parseFloat(style.getPropertyValue("--offset"));
          return [from, from + length];
        }),
      );
    spans.sort((a, b) => a[0] - b[0]);
    for (const [i, [from, to]] of spans.entries()) {
      // A pill at least three times as long as it is wide, round ends included: the dash itself is at least twice the
      // stroke (10 of a ring of radius 50, so 6.37 % of it).
      expect(to - from).toBeGreaterThan(6.3);
      // Clear of the next one by more than both round ends.
      if (i > 0) expect(from - spans[i - 1][1]).toBeGreaterThan(3);
    }
  });

  test("should mark the ring's movement in the planned sets, and switch the ring from there", async ({ page }) => {
    await startPlanned(page);
    const planned = page.getByRole("region", { name: "Planned sets" });
    await expect(planned.getByText("Now", { exact: true })).toHaveCount(1);
    await expect(planned.locator('[data-current="true"]')).toContainText("Bench Press");

    await planned.getByRole("button", { name: "Make Overhead Press the current movement" }).click();

    await expect(ringMovement(page)).toHaveText("Overhead Press");
    await expect(planned.locator('[data-current="true"]')).toContainText("Overhead Press");
  });

  test("should open the movement sheet from the round + button in the header", async ({ page }) => {
    await startPlanned(page);
    const add = page.getByRole("button", { name: "Add movement", exact: true });
    await expect(add).toHaveText("");
    await add.click();
    await expect(page.getByRole("dialog", { name: "Choose a movement" })).toBeVisible();
  });
});

test.describe("Workout ring on a phone", () => {
  test.use({ viewport: { width: 375, height: 740 } });

  test("should fit the controls in the window", async ({ page }) => {
    await startPlanned(page);
    await expect(ring(page)).toBeVisible();
    for (const name of [
      "Next set: 10 × no weight",
      "Next movement: Overhead Press",
      "Pause workout",
      "Finish Workout",
    ]) {
      const box = await page.getByRole("button", { name }).boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(375);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  });
  test("should swipe between the ring and the list, with tabs that follow", async ({ page }) => {
    await startPlanned(page);
    const ringTab = page.getByRole("tab", { name: "Ring" });
    const listTab = page.getByRole("tab", { name: /^List/ });
    await expect(ringTab).toHaveAttribute("aria-selected", "true");
    await expect(listTab).toContainText("0/6");

    // A swipe is a sideways scroll of the panes, snapped to one of them.
    await page.locator(".swipe-panes").evaluate((el) => el.scrollTo({ left: el.clientWidth }));
    await expect(listTab).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("tabpanel", { name: /^List/ }).getByText("Planned from Push day")).toBeInViewport();

    await page
      .getByRole("button", { name: /^Log planned Bench Press set/ })
      .first()
      .click();
    await expect(listTab).toContainText("1/6");

    await ringTab.click();
    await expect(ringTab).toHaveAttribute("aria-selected", "true");
    await expect(clock(page)).toBeInViewport();
  });

  test("should slide back to the set form when a planned set is adjusted from the list", async ({ page }) => {
    await startPlanned(page);
    await page.getByRole("tab", { name: /^List/ }).click();
    await page
      .getByRole("button", { name: /^Adjust planned Overhead Press set/ })
      .first()
      .click();

    await expect(page.getByRole("tab", { name: "Ring" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("group", { name: "Selected movement" })).toContainText("Overhead Press");
    await expect(page.getByLabel("Reps", { exact: true })).toBeInViewport();
  });
});
