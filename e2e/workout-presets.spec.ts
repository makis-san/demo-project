import { test, expect, gotoApp, newTestUser, signUp, waitForHydration } from "./fixtures";
import { getDb } from "./db";
import {
  addMovement,
  createWorkout,
  goTo,
  logBodyWeight,
  pickMovements,
  setRows,
  startWorkout,
  pressStart,
} from "./helpers";

const toast = (page: import("@playwright/test").Page) => page.locator(".Toastify__toast");
const exercise = (page: import("@playwright/test").Page, name: string) => page.locator(`[data-exercise="${name}"]`);
const sets = (page: import("@playwright/test").Page, name: string) =>
  page.getByRole("list", { name: `Sets of ${name}` }).getByRole("listitem");

async function newWorkoutForm(page: import("@playwright/test").Page) {
  await goTo(page, "Workout Library");
  await page.getByRole("link", { name: "Create your first workout" }).click();
  await expect(page.getByRole("button", { name: "Save workout" })).toBeVisible();
}

test.describe("Workout library", () => {
  test("should start empty, and say how to begin", async ({ page }) => {
    await goTo(page, "Workout Library");

    await expect(page.getByText("No workouts yet")).toBeVisible();
    await expect(page.getByRole("link", { name: "Create your first workout" })).toBeVisible();
  });

  test.describe("building a workout", () => {
    test("should pick several movements at once from cards, each with three sets of ten and a 60 second rest", async ({
      page,
    }) => {
      await newWorkoutForm(page);
      await page.getByLabel("Workout name").fill("Upper");
      await pickMovements(page, ["Bench Press", "Barbell Row"]);

      for (const name of ["Bench Press", "Barbell Row"]) {
        await expect(sets(page, name)).toHaveCount(3);
        await expect(page.getByLabel(`Rest after each set of ${name}, in seconds`)).toHaveValue("60");
        await expect(page.getByLabel(`Reps of set 1 of ${name}`)).toHaveValue("10");
        await expect(page.getByLabel(`Weight of set 1 of ${name}, optional`)).toHaveValue("");
      }
      await expect(page.getByText("2 movements · 6 sets")).toBeVisible();
    });

    test("should edit the series of a movement in place, without adding the movement again", async ({ page }) => {
      await newWorkoutForm(page);
      await pickMovements(page, ["Bench Press"]);

      await page.getByLabel("Reps of set 1 of Bench Press").fill("8");
      await page.getByLabel("Weight of set 1 of Bench Press, optional").fill("100");
      // A new set starts as a copy of the last one.
      await page.getByLabel("Reps of set 3 of Bench Press").fill("6");
      await page.getByRole("button", { name: "Add a set to Bench Press" }).click();
      await expect(sets(page, "Bench Press")).toHaveCount(4);
      await expect(page.getByLabel("Reps of set 4 of Bench Press")).toHaveValue("6");
      await page.getByRole("button", { name: "Remove set 2 of Bench Press" }).click();
      await expect(sets(page, "Bench Press")).toHaveCount(3);
      await expect(page.getByLabel("Reps of set 2 of Bench Press")).toHaveValue("6");

      // One movement, all along.
      await expect(page.locator("[data-exercise]")).toHaveCount(1);
      // The last set cannot be removed: a movement has at least one.
      await page.getByRole("button", { name: "Remove set 3 of Bench Press" }).click();
      await page.getByRole("button", { name: "Remove set 2 of Bench Press" }).click();
      await expect(page.getByRole("button", { name: "Remove set 1 of Bench Press" })).toBeDisabled();
    });

    test("should set the rest with the choices or by typing, and move and remove movements", async ({ page }) => {
      await newWorkoutForm(page);
      await pickMovements(page, ["Bench Press", "Barbell Row", "Back Squat"]);

      await exercise(page, "Bench Press").getByRole("button", { name: "90s" }).click();
      await expect(page.getByLabel("Rest after each set of Bench Press, in seconds")).toHaveValue("90");
      await page.getByLabel("Rest after each set of Barbell Row, in seconds").fill("75");

      await page.getByRole("button", { name: "Move Back Squat up" }).click();
      await expect(page.locator("[data-exercise]")).toHaveText([/Bench Press/, /Back Squat/, /Barbell Row/]);
      await page.getByRole("button", { name: "Remove Back Squat" }).click();
      await expect(page.locator("[data-exercise]")).toHaveCount(2);
    });

    test("should save it to the library, with the weight left empty where none was given", async ({ page, user }) => {
      await newWorkoutForm(page);
      await page.getByLabel("Workout name").fill("Push day");
      await pickMovements(page, ["Bench Press", "Overhead Press"]);
      await page.getByLabel("Weight of set 1 of Bench Press, optional").fill("100");
      await page.getByLabel("Reps of set 1 of Bench Press").fill("5");
      await exercise(page, "Overhead Press").getByRole("button", { name: "120s" }).click();
      await page.getByRole("button", { name: "Save workout" }).click();

      await expect(
        page.getByRole("list", { name: "Your workouts" }).getByText("Push day", { exact: true }),
      ).toBeVisible();
      await expect(page.getByText("2 movements · 6 sets")).toBeVisible();

      const preset = await getDb().workoutPreset.findFirstOrThrow({
        where: { user: { email: user.email } },
        include: {
          exercises: {
            orderBy: { position: "asc" },
            include: { movement: true, sets: { orderBy: { position: "asc" } } },
          },
        },
      });
      expect(preset.exercises.map((e) => [e.movement.name, e.restSeconds, e.sets.length])).toEqual([
        ["Bench Press", 60, 3],
        ["Overhead Press", 120, 3],
      ]);
      expect(preset.exercises[0].sets.map((s) => [s.reps, s.weight?.toNumber() ?? null])).toEqual([
        [5, 100],
        [10, null],
        [10, null],
      ]);
    });

    test("should reopen with everything as it was saved, and save changes to it", async ({ page }) => {
      await createWorkout(page, "Pull day", ["Barbell Row", "Lat Pulldown"]);
      await page.getByRole("link", { name: "Edit Pull day" }).click();
      await expect(page.getByLabel("Workout name")).toHaveValue("Pull day");
      await expect(page.locator("[data-exercise]")).toHaveText([/Barbell Row/, /Lat Pulldown/]);

      await page.getByLabel("Workout name").fill("Pull day B");
      await page.getByLabel("Reps of set 1 of Lat Pulldown").fill("12");
      await page.getByRole("button", { name: "Remove Barbell Row" }).click();
      await page.getByRole("button", { name: "Save workout" }).click();

      await expect(page.getByText("Pull day B", { exact: true })).toBeVisible();
      await expect(page.getByText("Pull day", { exact: true })).toHaveCount(0);
      await page.getByRole("link", { name: "Edit Pull day B" }).click();
      await expect(page.locator("[data-exercise]")).toHaveText([/Lat Pulldown/]);
      await expect(page.getByLabel("Reps of set 1 of Lat Pulldown")).toHaveValue("12");
    });

    test("should say what is missing, and not save until it is fixed", async ({ page }) => {
      await newWorkoutForm(page);
      const save = page.getByRole("button", { name: "Save workout" });

      await expect(save).toBeDisabled();
      await expect(page.getByText("Give the workout a name")).toBeVisible();
      await page.getByLabel("Workout name").fill("Legs");
      await expect(page.getByText("Add at least one movement")).toBeVisible();

      await pickMovements(page, ["Back Squat"]);
      await expect(save).toBeEnabled();
      await page.getByLabel("Reps of set 1 of Back Squat").fill("0");
      await expect(save).toBeDisabled();
      await expect(page.getByText("Back Squat, set 1: reps must be a whole number from 1 to 1000")).toBeVisible();
      await page.getByLabel("Reps of set 1 of Back Squat").fill("5");
      await page.getByLabel("Weight of set 1 of Back Squat, optional").fill("100.123");
      await expect(save).toBeDisabled();
      await expect(page.getByText("Use at most 2 decimal places", { exact: false })).toBeVisible();
      await page.getByLabel("Weight of set 1 of Back Squat, optional").fill("");
      await page.getByLabel("Rest after each set of Back Squat, in seconds").fill("4000");
      await expect(save).toBeDisabled();
      await page.getByLabel("Rest after each set of Back Squat, in seconds").fill("0");
      await expect(save).toBeEnabled();
    });

    test("should not take the name of another of the user's workouts", async ({ page }) => {
      await createWorkout(page, "Legs", ["Back Squat"]);
      await goTo(page, "Workout Library");
      await page.getByRole("link", { name: "New workout" }).click();
      await page.getByLabel("Workout name").fill("Legs");
      await pickMovements(page, ["Leg Press"]);
      await page.getByRole("button", { name: "Save workout" }).click();

      await expect(toast(page)).toContainText("You already have a workout with this name");
    });

    test("should find movements by body part and by name in the chooser, and load more as it scrolls", async ({
      page,
    }) => {
      await newWorkoutForm(page);
      await page.getByRole("button", { name: "Add movements" }).click();
      const dialog = page.getByRole("dialog", { name: "Add movements" });
      const cards = dialog.getByRole("list", { name: "Movements" }).getByRole("listitem");

      await expect(cards).toHaveCount(20);
      await dialog.getByRole("tab", { name: /^Legs/ }).click();
      await expect(dialog.getByRole("checkbox", { name: "Select Back Squat" })).toBeVisible();
      await expect(dialog.getByRole("checkbox", { name: "Select Bench Press" })).toHaveCount(0);
      const list = dialog.getByRole("list", { name: "Movements" }).locator("xpath=..");
      await expect
        .poll(
          async () => {
            await list.evaluate((el) => el.scrollTo(0, el.scrollHeight));
            return cards.count();
          },
          { timeout: 15_000 },
        )
        .toBe(30);

      // Ticks survive changing the tab and the search.
      await dialog.getByRole("checkbox", { name: "Select Back Squat" }).click();
      await dialog.getByRole("tab", { name: /^Chest/ }).click();
      await dialog.getByRole("checkbox", { name: "Select Bench Press" }).click();
      await expect(dialog.getByText("2 selected")).toBeVisible();
      await dialog.getByRole("button", { name: "Add 2 movements" }).click();
      await expect(page.locator("[data-exercise]")).toHaveText([/Back Squat/, /Bench Press/]);
    });

    test("should close the chooser with Escape and add nothing", async ({ page }) => {
      await newWorkoutForm(page);
      await page.getByRole("button", { name: "Add movements" }).click();
      await page.getByRole("checkbox", { name: "Select Bench Press" }).click();
      await page.keyboard.press("Escape");

      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page.locator("[data-exercise]")).toHaveCount(0);
    });
  });

  test.describe("server rules", () => {
    test("should not save a movement that is another user's", async ({ page, browser }) => {
      const other = newTestUser();
      const otherContext = await browser.newContext();
      const otherPage = await otherContext.newPage();
      await signUp(otherPage, other);
      await addMovement(otherPage, "Foreign Lift");
      await otherContext.close();
      const foreign = await getDb().movement.findFirstOrThrow({ where: { user: { email: other.email } } });
      const own = await getDb().movement.findFirstOrThrow({ where: { userId: null, name: "Bench Press" } });

      await newWorkoutForm(page);
      await page.getByLabel("Workout name").fill("Sneaky");
      await pickMovements(page, ["Bench Press"]);
      await page.route("**/_serverFn/**", async (route) => {
        const body = route.request().postData();
        if (route.request().method() === "POST" && body?.includes(own.id)) {
          await route.continue({ postData: body.replaceAll(own.id, foreign.id) });
        } else await route.continue();
      });
      await page.getByRole("button", { name: "Save workout" }).click();

      await expect(toast(page)).toContainText("Movement not found");
      expect(await getDb().workoutPreset.count({ where: { name: "Sneaky" } })).toBe(0);
    });

    test("should not show, start, change or delete another user's workout", async ({ page, browser, user }) => {
      const other = newTestUser();
      const otherContext = await browser.newContext();
      const otherPage = await otherContext.newPage();
      await signUp(otherPage, other);
      await createWorkout(otherPage, "Their workout", ["Bench Press"]);
      await otherContext.close();
      const theirs = await getDb().workoutPreset.findFirstOrThrow({ where: { user: { email: other.email } } });

      await gotoApp(page, `/workout-library/${theirs.id}`);
      await expect(page.getByText("That workout doesn't exist.")).toBeVisible();
      await gotoApp(page, `/start-workout?preset=${theirs.id}`);
      await expect(page.getByText("That workout doesn't exist.")).toBeVisible();

      // A request that names it anyway is refused: starting it, saving over it, deleting it.
      await createWorkout(page, "Mine", ["Back Squat"]);
      const mine = await getDb().workoutPreset.findFirstOrThrow({ where: { user: { email: user.email } } });
      await page.route("**/_serverFn/**", async (route) => {
        const body = route.request().postData();
        if (route.request().method() === "POST" && body?.includes(mine.id)) {
          await route.continue({ postData: body.replaceAll(mine.id, theirs.id) });
        } else await route.continue();
      });
      await gotoApp(page, `/start-workout?preset=${mine.id}`);
      await pressStart(page, { wait: false });
      await expect(toast(page)).toContainText("Workout not found", { timeout: 15_000 });
      await gotoApp(page, `/workout-library/${mine.id}`);
      await page.getByLabel("Workout name").fill("Hijacked");
      await page.getByRole("button", { name: "Save workout" }).click();
      await expect(toast(page).last()).toContainText("Workout not found");
      await page.getByRole("button", { name: "Delete" }).click();
      await page.getByRole("button", { name: "Yes, delete" }).click();
      await expect(toast(page).last()).toContainText("Workout not found");

      const after = await getDb().workoutPreset.findUniqueOrThrow({ where: { id: theirs.id } });
      expect(after.name).toBe("Their workout");
    });
  });

  test.describe("starting a workout from the library", () => {
    test("should show the plan first and start nothing until Start is pressed", async ({ page, user }) => {
      await createWorkout(page, "Push day", ["Bench Press", "Overhead Press"]);
      await page.getByRole("link", { name: "Edit Push day" }).click();
      await exercise(page, "Bench Press").getByRole("button", { name: "90s" }).click();
      await page.getByLabel("Weight of set 1 of Bench Press, optional").fill("100");
      await page.getByRole("button", { name: "Save workout" }).click();

      await page.getByRole("link", { name: "Start Push day" }).click();

      await expect(page.getByRole("heading", { level: 1, name: "Push day" })).toBeVisible();
      const plan = page.getByRole("list", { name: "Movements in this workout" });
      await expect(plan.locator("[data-movement]")).toHaveCount(2);
      await expect(plan.locator('[data-movement="Bench Press"]')).toContainText("3 sets");
      await expect(plan.locator('[data-movement="Bench Press"]')).toContainText("1:30 rest");
      // The weight shows where there is one, and the sets without one just say the reps.
      await expect(plan.locator('[data-movement="Bench Press"]')).toContainText("10 reps × 100 lbs");
      await expect(plan.locator('[data-movement="Overhead Press"]')).not.toContainText("lbs");
      await expect(page.getByRole("button", { name: "Finish Workout" })).toHaveCount(0);
      expect(await getDb().workout.count({ where: { user: { email: user.email } } })).toBe(0);

      await pressStart(page);

      await expect(page).toHaveURL(/\/current-workout/);
      await expect(page.getByRole("button", { name: "Finish Workout" })).toBeVisible();
      await expect(page.getByText("Planned from Push day")).toBeVisible();
      await expect(page.getByText("0 of 6 logged", { exact: true })).toBeVisible();
      const workout = await getDb().workout.findFirstOrThrow({ where: { user: { email: user.email } } });
      expect(workout.presetId).not.toBeNull();
    });

    test("should log planned sets with or without a weight, and rest as the workout asks", async ({ page }) => {
      await createWorkout(page, "Push day", ["Bench Press"]);
      await page.getByRole("link", { name: "Edit Push day" }).click();
      await page
        .getByRole("group", { name: "Rest choices for Bench Press" })
        .getByRole("button", { name: "90s" })
        .click();
      await page.getByLabel("Weight of set 1 of Bench Press, optional").fill("100");
      await page.getByRole("button", { name: "Save workout" }).click();
      await page.getByRole("link", { name: "Start Push day" }).click();
      await pressStart(page);

      // The planned set with a weight is logged as planned, and the rest is the workout's, not the device's.
      await page.getByRole("button", { name: "Log planned Bench Press set: 10 × 100 lbs" }).click();
      await expect(setRows(page)).toContainText("10 reps × 100 lbs");
      await expect(page.getByText("0 of 3 logged", { exact: true })).toHaveCount(0);
      await expect(page.getByText("1 of 3 logged", { exact: true })).toBeVisible();
      await expect(page.getByText("Resting")).toBeVisible();
      await expect(page.getByText(/^1:(30|29|28)$/).first()).toBeVisible();

      // A planned set with no weight can be adjusted first: the weight is left for the user to type.
      await page.getByRole("button", { name: "Adjust planned Bench Press set: 10 reps" }).first().click();
      await expect(page.getByLabel("Weight", { exact: true })).toHaveValue("");
      await expect(page.getByLabel("Reps", { exact: true })).toHaveValue("10");
      await page.getByLabel("Weight", { exact: true }).fill("80");
      await page.getByRole("button", { name: "Add", exact: true }).click();
      await expect(setRows(page)).toHaveCount(2);
      await expect(page.getByText("2 of 3 logged", { exact: true })).toBeVisible();

      // Or logged as it is: with no weight it is logged with 0.
      await page.getByRole("button", { name: "Log planned Bench Press set: 10 reps" }).click();
      await expect(setRows(page)).toHaveCount(3);
      await expect(page.getByText("3 of 3 logged", { exact: true })).toBeVisible();
    });

    test("should start a body-weight movement with no planned weight from the user's body weight", async ({ page }) => {
      await logBodyWeight(page, 181);
      await createWorkout(page, "Pull day", ["Pull-Up"]);
      await page.getByRole("link", { name: "Start Pull day" }).click();
      await pressStart(page);

      await page.getByRole("button", { name: "Log planned Pull-Up set: 10 reps" }).first().click();
      await expect(setRows(page)).toContainText("10 reps × 181 lbs");
    });

    test("should keep the checklist after a reload, and drop it when the workout is deleted", async ({ page }) => {
      await createWorkout(page, "Legs", ["Back Squat"]);
      await page.getByRole("link", { name: "Start Legs" }).click();
      await pressStart(page);
      await page.getByRole("button", { name: "Log planned Back Squat set: 10 reps" }).first().click();
      await expect(page.getByText("1 of 3 logged", { exact: true })).toBeVisible();
      await page.reload();
      // Wait for React to take over, or the next click can land on the server's HTML and do nothing.
      await waitForHydration(page);
      await expect(page.getByText("1 of 3 logged", { exact: true })).toBeVisible();

      await goTo(page, "Workout Library");
      await page.getByRole("link", { name: "Edit Legs" }).click();
      await page.getByRole("button", { name: "Delete" }).click();
      await page.getByRole("button", { name: "Yes, delete" }).click();
      await expect(page.getByText("No workouts yet")).toBeVisible();

      // The workout in progress keeps its sets and loses the checklist.
      await goTo(page, "Current Workout");
      await expect(setRows(page)).toHaveCount(1);
      await expect(page.getByText(/^Planned from/)).toHaveCount(0);
    });

    test("should not start a second workout while one is open, and say so", async ({ page }) => {
      await createWorkout(page, "Legs", ["Back Squat"]);
      await startWorkout(page);
      await goTo(page, "Workout Library");
      await page.getByRole("link", { name: "Start Legs" }).click();

      await expect(page.getByText("You have a workout in progress.")).toBeVisible();
      await expect(page.getByRole("button", { name: "Start workout" })).toBeDisabled();
    });

    test("should offer to start from the current workout page, with the workout of the day first", async ({ page }) => {
      await goTo(page, "Current Workout");
      await expect(page.getByRole("link", { name: "Choose a workout" })).toBeVisible();
      await page.getByRole("link", { name: "Choose a workout" }).click();
      await expect(page.getByRole("heading", { level: 1, name: "Workout Library" })).toBeVisible();
    });
  });
});

test.describe("Workout library on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("should fit the window on every new screen", async ({ page }) => {
    const noSideways = async () =>
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    // No weekday chips here: the dev-only devtools button floats over the first one on a phone and takes the tap.
    await createWorkout(page, "Push day", ["Bench Press", "Overhead Press", "Dip"]);
    await noSideways();

    await page.getByRole("link", { name: "Edit Push day" }).click();
    await expect(page.locator("[data-exercise]")).toHaveCount(3);
    await noSideways();
    await page.getByRole("button", { name: "Add movements" }).click();
    await expect(page.getByRole("dialog", { name: "Add movements" })).toBeVisible();
    await noSideways();
    await page.keyboard.press("Escape");

    await page.goto("/start-workout");
    await expect(page.getByRole("button", { name: "Start workout" })).toBeVisible();
    await noSideways();
    await goTo(page, "Home");
    await noSideways();
    // Every item of the five-item dock is on the screen and tappable.
    for (const label of ["Home", "Library", "Current Workout", "Workout History", "Body Weight"]) {
      const box = await page.getByRole("link", { name: label, exact: true }).boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(390);
      expect(box!.width).toBeGreaterThan(40);
    }
  });
});
