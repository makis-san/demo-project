import { test, expect, gotoApp, newTestUser, signUp, waitForHydration } from "./fixtures";
import { getDb, seedCompletedWorkouts } from "./db";
import { addMovement, completeWorkout, createWorkout, goTo, movementRow, setRows, startWorkout } from "./helpers";

type Page = import("@playwright/test").Page;

const toast = (page: Page) => page.locator(".Toastify__toast");
/** The toast with this text. A success toast from an earlier step can still be on its way out, so look for the text. */
const toastWith = (page: Page, text: string) => toast(page).filter({ hasText: text });

/** A completed workout straight in the database, with one set of a movement, which becomes the user's own if it is not built in. */
function logSet(email: string, movement: string, weight: number, reps: number) {
  return seedCompletedWorkouts(email, [{ completedAt: new Date(), sets: [{ movement, weight, reps }] }]);
}

/** Opens a movement's own page from the library. */
async function openMovement(page: Page, name: string) {
  await goTo(page, "Movements");
  await movementRow(page, name).getByRole("link").click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
}

/** Presses Delete on a movement's page and confirms in the page. The label says which of the two it will be. */
async function removeMovement(page: Page, name: string, confirm: "Yes, delete it" | "Yes, archive it") {
  await openMovement(page, name);
  await page.getByRole("button", { name: "Delete movement" }).click();
  await page.getByRole("button", { name: confirm }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Movements" })).toBeVisible();
}

/** The movement's row in the database, with how many sets and preset entries point at it. */
function movementInDb(email: string, name: string) {
  return getDb().movement.findFirst({
    where: { name, user: { email } },
    include: { _count: { select: { sets: true, presetExercises: true } } },
  });
}

test.describe("Movements", () => {
  test.describe("create", () => {
    test("should create a new movement with a valid name", async ({ page, user }) => {
      await goTo(page, "Movements");
      await page.getByLabel("Movement name").fill("Tempo Front Squat");
      await page.getByRole("button", { name: "Add", exact: true }).click();

      await expect(movementRow(page, "Tempo Front Squat")).toBeVisible();
      // A failure would show a toast, so no toast means the server accepted it.
      await expect(toast(page)).toHaveCount(0);
      const saved = await movementInDb(user.email, "Tempo Front Squat");
      expect(saved).not.toBeNull();
      expect(saved?.archivedAt).toBeNull();
    });

    test("should show the new movement in the movements list", async ({ page }) => {
      await addMovement(page, "Pause Bench Press");

      await expect(movementRow(page, "Pause Bench Press")).toContainText("Yours");
      // It is in the list the server sends, not only on the page: a reload and the Mine filter both show it.
      await page.reload();
      await waitForHydration(page);
      await page.getByRole("button", { name: /^Mine/ }).click();
      await expect(page.getByRole("list", { name: "Movements" }).getByRole("link")).toHaveText(["Pause Bench Press"]);
    });

    test("should clear the input after creating a movement", async ({ page }) => {
      await addMovement(page, "Deficit Deadlift");

      await expect(page.getByLabel("Movement name")).toHaveValue("");
    });
  });

  test.describe("read", () => {
    test("should display all movements on the movements page", async ({ page }) => {
      // The library has built-ins now, so "all of the user's movements" is the Mine filter.
      const names = ["Hex Bar Deadlift", "Ring Dip Hold", "Sandbag Carry"];
      for (const name of names) await addMovement(page, name);

      await page.getByRole("button", { name: /^Mine/ }).click();
      const list = page.getByRole("list", { name: "Movements" }).getByRole("listitem");
      await expect(list).toHaveCount(names.length);
      for (const name of names) await expect(movementRow(page, name)).toBeVisible();
      // The count on the filter is the same number, and the built-ins are hidden by it.
      await expect(page.getByRole("button", { name: /^Mine/ })).toContainText(String(names.length));
      await expect(movementRow(page, "Bench Press")).toHaveCount(0);
    });

    test("should show movements sorted alphabetically", async ({ page }) => {
      // Added out of order on purpose, and one of them belongs in the middle.
      for (const name of ["Yoke Walk", "Axle Clean", "Landmine Press Wide", "Sled Drag"]) await addMovement(page, name);

      await page.getByRole("button", { name: /^Mine/ }).click();
      const shown = page.getByRole("list", { name: "Movements" }).getByRole("link");
      await expect(shown).toHaveText(["Axle Clean", "Landmine Press Wide", "Sled Drag", "Yoke Walk"]);
      // After a reload the server sends them in the same order.
      await page.reload();
      await waitForHydration(page);
      await page.getByRole("button", { name: /^Mine/ }).click();
      await expect(shown).toHaveText(["Axle Clean", "Landmine Press Wide", "Sled Drag", "Yoke Walk"]);
    });
  });

  test.describe("delete", () => {
    test("should delete an existing movement", async ({ page, user }) => {
      await addMovement(page, "Throwaway Lift");
      await openMovement(page, "Throwaway Lift");

      // The confirmation is in the page, not a browser dialog, and nothing is deleted before it is answered.
      let dialogs = 0;
      page.on("dialog", (dialog) => {
        dialogs++;
        void dialog.dismiss();
      });
      await page.getByRole("button", { name: "Delete movement" }).click();
      await expect(page.getByRole("alert").filter({ hasText: "Delete Throwaway Lift?" })).toBeVisible();
      expect(await movementInDb(user.email, "Throwaway Lift")).not.toBeNull();
      await page.getByRole("button", { name: "Yes, delete it" }).click();

      await expect(page).toHaveURL(/\/movements$/);
      await expect(toastWith(page, "Throwaway Lift deleted")).toBeVisible();
      // Nothing used it, so the row is gone and not only hidden.
      expect(await movementInDb(user.email, "Throwaway Lift")).toBeNull();
      expect(dialogs).toBe(0);
    });

    test("should remove the movement from the list after deletion", async ({ page }) => {
      await addMovement(page, "Throwaway Row");
      await addMovement(page, "Keeper Row");

      await removeMovement(page, "Throwaway Row", "Yes, delete it");

      await expect(movementRow(page, "Throwaway Row")).toHaveCount(0);
      await expect(movementRow(page, "Keeper Row")).toBeVisible();
      // Not only on the page: a reload and the Mine filter agree.
      await page.reload();
      await waitForHydration(page);
      await expect(movementRow(page, "Throwaway Row")).toHaveCount(0);
      await page.getByRole("button", { name: /^Mine/ }).click();
      await expect(page.getByRole("list", { name: "Movements" }).getByRole("link")).toHaveText(["Keeper Row"]);
    });

    test("should keep the movement when the user changes their mind", async ({ page, user }) => {
      await addMovement(page, "Second Thoughts Curl");
      await openMovement(page, "Second Thoughts Curl");

      await page.getByRole("button", { name: "Delete movement" }).click();
      await page.getByRole("button", { name: "Keep it" }).click();

      await expect(page.getByRole("button", { name: "Delete movement" })).toBeVisible();
      await expect(page.getByRole("button", { name: /^Yes, / })).toHaveCount(0);
      expect(await movementInDb(user.email, "Second Thoughts Curl")).not.toBeNull();
    });

    test("should fit a 390px wide phone, with the confirmation inside the window", async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await addMovement(page, "Narrow Screen Curl");
      await openMovement(page, "Narrow Screen Curl");
      await page.getByRole("button", { name: "Delete movement" }).click();

      const yes = page.getByRole("button", { name: "Yes, delete it" });
      await yes.scrollIntoViewIfNeeded();
      const box = await yes.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(390);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    });
  });

  test.describe("archive a used movement", () => {
    test("should archive it instead of deleting it, keeping its sets in history and its chart", async ({
      page,
      user,
    }) => {
      test.slow();
      await addMovement(page, "Archive Me Press");
      await completeWorkout(page, [{ movement: "Archive Me Press", weight: 80, reps: 6 }]);

      await openMovement(page, "Archive Me Press");
      await page.getByRole("button", { name: "Delete movement" }).click();
      // The text says what will happen before the user decides.
      await expect(page.getByRole("alert")).toContainText("will be archived");
      await page.getByRole("button", { name: "Yes, archive it" }).click();
      await expect(page.getByRole("heading", { level: 1, name: "Movements" })).toBeVisible();
      await expect(toastWith(page, "Archive Me Press archived")).toBeVisible();

      // The row and its set are still there, only marked.
      const row = await movementInDb(user.email, "Archive Me Press");
      expect(row?.archivedAt).not.toBeNull();
      expect(row?._count.sets).toBe(1);

      // Gone from the library, also after a reload, and from the Mine count.
      await expect(movementRow(page, "Archive Me Press")).toHaveCount(0);
      await page.reload();
      await waitForHydration(page);
      await expect(movementRow(page, "Archive Me Press")).toHaveCount(0);
      await expect(page.getByRole("button", { name: /^Mine/ })).toContainText("0");

      // Gone from the picker of a new workout.
      await startWorkout(page);
      await page.getByRole("button", { name: "Add movement", exact: true }).click();
      const sheet = page.getByRole("dialog", { name: "Choose a movement" });
      await sheet.getByRole("searchbox", { name: "Search movements" }).fill("Archive Me");
      await expect(sheet.getByText("No movement matches")).toBeVisible();
      await expect(sheet.getByRole("button", { name: "Archive Me Press" })).toHaveCount(0);
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "Finish Workout" }).click();

      // Still in history, with its numbers.
      await goTo(page, "Workout History");
      const rows = page.getByRole("row").filter({ has: page.getByRole("checkbox", { name: "Select workout" }) });
      await expect(page.getByRole("columnheader", { name: "Archive Me Press" })).toBeVisible();
      // Two rows: the workout that has the set, and the empty one from the check of the picker above.
      await expect(rows.filter({ hasText: "80 lbs / 6 reps / 1 sets" })).toHaveCount(1);
      // And in the progression chart, which lists it and plots it.
      await page.getByLabel("Movement", { exact: true }).selectOption({ label: "Archive Me Press" });
      await expect(page.getByRole("img", { name: "Max weight for Archive Me Press over time" })).toBeVisible();
      await expect(page.getByRole("img", { name: /over time$/ }).locator("circle title")).toHaveText([/^80 lbs on /]);
    });

    test("should say it is archived on its own page, and offer no second delete", async ({ page, user }) => {
      await logSet(user.email, "Archived Page Lift", 50, 10);
      await gotoApp(page, "/movements");
      await removeMovement(page, "Archived Page Lift", "Yes, archive it");
      const id = (
        await getDb().movement.findFirstOrThrow({ where: { name: "Archived Page Lift", user: { email: user.email } } })
      ).id;

      await gotoApp(page, `/movements/${id}`);

      await expect(page.getByRole("heading", { level: 1, name: "Archived Page Lift" })).toBeVisible();
      await expect(page.getByText("Archived", { exact: true })).toBeVisible();
      await expect(page.getByText("This movement is archived.")).toBeVisible();
      await expect(page.getByRole("button", { name: "Delete movement" })).toHaveCount(0);
      // Its numbers are still there.
      await expect(page.getByText("Last top set")).toBeVisible();
    });

    test("should keep it in the current workout that already has sets of it", async ({ page }) => {
      test.slow();
      await addMovement(page, "Mid Workout Lift");
      await startWorkout(page);
      await page.getByRole("button", { name: "Add movement", exact: true }).click();
      const sheet = page.getByRole("dialog", { name: "Choose a movement" });
      await sheet.getByRole("searchbox", { name: "Search movements" }).fill("Mid Workout Lift");
      await sheet.getByRole("button", { name: "Mid Workout Lift", exact: true }).click();
      await page.getByLabel("Weight").fill("40");
      await page.getByLabel("Reps").fill("12");
      await page.getByRole("button", { name: "Add", exact: true }).click();
      await expect(setRows(page)).toHaveCount(1);

      await removeMovement(page, "Mid Workout Lift", "Yes, archive it");

      await goTo(page, "Current Workout");
      await expect(setRows(page)).toHaveCount(1);
      await expect(setRows(page).first()).toContainText("Mid Workout Lift");
      // The workout can still be finished with it, and the set is in history.
      await page.getByRole("button", { name: "Finish Workout" }).click();
      await goTo(page, "Workout History");
      await expect(page.getByRole("columnheader", { name: "Mid Workout Lift" })).toBeVisible();
    });

    test("should keep it in a workout of the library that has it, and still start that workout", async ({
      page,
      user,
    }) => {
      test.slow();
      await addMovement(page, "Preset Only Lift");
      await createWorkout(page, "Archive day", ["Preset Only Lift", "Bench Press"]);
      // In a preset and in no set: it is still "used", so it is archived and not deleted.
      await removeMovement(page, "Preset Only Lift", "Yes, archive it");
      const row = await movementInDb(user.email, "Preset Only Lift");
      expect(row?.archivedAt).not.toBeNull();
      expect(row?._count.presetExercises).toBe(1);

      // The workout still has it, and saving the workout again keeps it.
      await goTo(page, "Workout Library");
      await page.getByRole("link", { name: "Edit Archive day" }).click();
      await expect(page.locator("[data-exercise]")).toHaveText([/Preset Only Lift/, /Bench Press/]);
      await page.getByRole("button", { name: "Save workout" }).click();
      await expect(page.getByRole("heading", { level: 1, name: "Workout Library" })).toBeVisible();
      await expect(page.locator(".Toastify__toast--error")).toHaveCount(0);
      expect((await movementInDb(user.email, "Preset Only Lift"))?._count.presetExercises).toBe(1);

      // But it cannot be added to a workout from the chooser any more.
      await page.getByRole("link", { name: "Edit Archive day" }).click();
      await page.getByRole("button", { name: "Add movements" }).click();
      const dialog = page.getByRole("dialog", { name: "Add movements" });
      await dialog.getByRole("searchbox", { name: "Search movements" }).fill("Preset Only");
      await expect(dialog.getByText("No movement matches")).toBeVisible();
      await page.keyboard.press("Escape");

      // The workout starts, plans the archived movement, and its sets can be logged.
      await goTo(page, "Workout Library");
      await page.getByRole("link", { name: "Start Archive day" }).click();
      await expect(page.locator('[data-movement="Preset Only Lift"]')).toBeVisible();
      await page.getByRole("button", { name: "Start workout" }).click();
      await expect(page).toHaveURL(/\/current-workout/, { timeout: 15_000 });
      await expect(page.getByText("Planned from Archive day")).toBeVisible();
      await expect(page.getByText("0 of 6 logged", { exact: true })).toBeVisible();
    });

    test("should not let a request add an archived movement to a workout that does not have it", async ({
      page,
      user,
    }) => {
      await logSet(user.email, "Request Test Lift", 30, 5);
      await gotoApp(page, "/movements");
      await removeMovement(page, "Request Test Lift", "Yes, archive it");
      const archived = await movementInDb(user.email, "Request Test Lift");
      const bench = await getDb().movement.findFirstOrThrow({ where: { userId: null, name: "Bench Press" } });

      await startWorkout(page);
      // The chooser does not offer it, so swap the id in the request the way an edited request would.
      await page.route("**/_serverFn/**", async (route) => {
        const body = route.request().postData();
        if (route.request().method() === "POST" && body?.includes(bench.id)) {
          await route.continue({ postData: body.replaceAll(bench.id, archived!.id) });
        } else await route.continue();
      });
      await page.getByRole("button", { name: "Add movement", exact: true }).click();
      const sheet = page.getByRole("dialog", { name: "Choose a movement" });
      await sheet.getByRole("searchbox", { name: "Search movements" }).fill("Bench Press");
      await sheet.getByRole("button", { name: "Bench Press", exact: true }).click();
      await page.getByLabel("Weight").fill("100");
      await page.getByLabel("Reps").fill("5");
      await page.getByRole("button", { name: "Add", exact: true }).click();

      await expect(toastWith(page, "Movement not found")).toBeVisible();
      await page.reload();
      await waitForHydration(page);
      await expect(setRows(page)).toHaveCount(0);
    });
  });

  test.describe("re-create an archived name", () => {
    test("should bring the archived movement back with its sets instead of failing", async ({ page, user }) => {
      test.slow();
      await logSet(user.email, "Phoenix Press", 60, 8);
      await gotoApp(page, "/movements");
      await removeMovement(page, "Phoenix Press", "Yes, archive it");
      const archived = await movementInDb(user.email, "Phoenix Press");
      expect(archived?.archivedAt).not.toBeNull();
      await expect(movementRow(page, "Phoenix Press")).toHaveCount(0);

      // The same name again, with a body-weight flag this time, as a user would type it.
      await page.getByLabel("Movement name").fill("Phoenix Press");
      await page.getByRole("checkbox", { name: /Body-weight movement/ }).check();
      await page.getByRole("button", { name: "Add", exact: true }).click();

      await expect(movementRow(page, "Phoenix Press")).toContainText("Body weight");
      await expect(toastWith(page, "Phoenix Press is back, with its history")).toBeVisible();
      // The same row came back, not a second one, and its set is under it.
      const rows = await getDb().movement.findMany({
        where: { name: "Phoenix Press", user: { email: user.email } },
        include: { _count: { select: { sets: true } } },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(archived!.id);
      expect(rows[0].archivedAt).toBeNull();
      expect(rows[0].isBodyWeight).toBe(true);
      expect(rows[0]._count.sets).toBe(1);
      // It is back in the pickers, and in the history it never left.
      await goTo(page, "Workout History");
      await expect(page.getByRole("columnheader", { name: "Phoenix Press" })).toBeVisible();
      await startWorkout(page);
      await page.getByRole("button", { name: "Add movement", exact: true }).click();
      const sheet = page.getByRole("dialog", { name: "Choose a movement" });
      await sheet.getByRole("searchbox", { name: "Search movements" }).fill("Phoenix");
      await expect(sheet.getByRole("button", { name: "Phoenix Press", exact: true })).toBeVisible();
    });

    test("should bring it back whatever the case of the name, using the name as typed", async ({ page, user }) => {
      await logSet(user.email, "Lazarus Lift", 20, 10);
      await gotoApp(page, "/movements");
      await removeMovement(page, "Lazarus Lift", "Yes, archive it");
      const archived = await movementInDb(user.email, "Lazarus Lift");

      await page.getByLabel("Movement name").fill("lazarus LIFT");
      await page.getByRole("button", { name: "Add", exact: true }).click();

      await expect(movementRow(page, "lazarus LIFT")).toBeVisible();
      const all = await getDb().movement.findMany({
        where: { name: { equals: "lazarus lift", mode: "insensitive" }, user: { email: user.email } },
      });
      expect(all.map((m) => [m.id, m.name, m.archivedAt])).toEqual([[archived!.id, "lazarus LIFT", null]]);
    });

    test("should still refuse a name that an active movement of the user has", async ({ page }) => {
      await addMovement(page, "Twin Lift");
      await page.getByLabel("Movement name").fill("Twin Lift");
      await page.getByRole("button", { name: "Add", exact: true }).click();

      await expect(toast(page)).toContainText("You already have a movement with this name");
    });
  });

  test.describe("what cannot be deleted", () => {
    test("should offer no delete on a built-in movement, and refuse a request to delete one", async ({
      page,
      user,
    }) => {
      const bench = await getDb().movement.findFirstOrThrow({ where: { userId: null, name: "Bench Press" } });
      await addMovement(page, "Decoy Lift");
      await openMovement(page, "Bench Press");
      await expect(page.getByRole("button", { name: "Delete movement" })).toHaveCount(0);

      // The decoy's page has the button, so send its request with the built-in's id, the way an edited request would.
      const decoy = await getDb().movement.findFirstOrThrow({
        where: { name: "Decoy Lift", user: { email: user.email } },
      });
      await openMovement(page, "Decoy Lift");
      await page.route("**/_serverFn/**", async (route) => {
        const body = route.request().postData();
        if (route.request().method() === "POST" && body?.includes(decoy.id)) {
          await route.continue({ postData: body.replaceAll(decoy.id, bench.id) });
        } else await route.continue();
      });
      await page.getByRole("button", { name: "Delete movement" }).click();
      await page.getByRole("button", { name: "Yes, delete it" }).click();

      await expect(toastWith(page, "Built-in movements cannot be deleted")).toBeVisible();
      const after = await getDb().movement.findUnique({ where: { id: bench.id } });
      expect(after).not.toBeNull();
      expect(after?.archivedAt).toBeNull();
      // The decoy was not touched either.
      expect(await getDb().movement.count({ where: { id: decoy.id } })).toBe(1);
    });

    test("should not show, delete or archive another user's movement", async ({ page, browser, user }) => {
      const other = newTestUser();
      const otherContext = await browser.newContext();
      const otherPage = await otherContext.newPage();
      await signUp(otherPage, other);
      await logSet(other.email, "Not Yours Lift", 70, 5);
      const foreign = await getDb().movement.findFirstOrThrow({ where: { user: { email: other.email } } });
      await otherContext.close();

      // The page of that movement says it does not exist and has no delete.
      await gotoApp(page, `/movements/${foreign.id}`);
      await expect(page.getByText("That movement doesn't exist.")).toBeVisible();
      await expect(page.getByRole("button", { name: "Delete movement" })).toHaveCount(0);

      // A request with its id, from the page of one of this user's own movements, is refused as "not found".
      await addMovement(page, "My Own Lift");
      const own = await getDb().movement.findFirstOrThrow({
        where: { name: "My Own Lift", user: { email: user.email } },
      });
      await openMovement(page, "My Own Lift");
      await page.route("**/_serverFn/**", async (route) => {
        const body = route.request().postData();
        if (route.request().method() === "POST" && body?.includes(own.id)) {
          await route.continue({ postData: body.replaceAll(own.id, foreign.id) });
        } else await route.continue();
      });
      await page.getByRole("button", { name: "Delete movement" }).click();
      await page.getByRole("button", { name: "Yes, delete it" }).click();

      await expect(toastWith(page, "Movement not found")).toBeVisible();
      const after = await getDb().movement.findUniqueOrThrow({
        where: { id: foreign.id },
        include: { _count: { select: { sets: true } } },
      });
      expect(after.archivedAt).toBeNull();
      expect(after._count.sets).toBe(1);
    });
  });

  test.describe("library", () => {
    test("should give a new account the built-in movements without creating anything", async ({ page }) => {
      await goTo(page, "Movements");

      // About a hundred, and the common lifts are in them.
      const total = await page.getByRole("list", { name: "Movements" }).getByRole("listitem").count();
      expect(total).toBeGreaterThanOrEqual(90);
      await expect(movementRow(page, "Bench Press")).toBeVisible();
      await expect(movementRow(page, "Back Squat")).toBeVisible();
      await expect(movementRow(page, "Pull-Up")).toContainText("Body weight");
      await expect(movementRow(page, "Bench Press")).not.toContainText("Body weight");
      await expect(page.getByText("Yours")).toHaveCount(0);
    });

    test("should find movements by name, muscle and equipment", async ({ page }) => {
      await goTo(page, "Movements");
      const names = () => page.getByRole("list", { name: "Movements" }).getByRole("link").allTextContents();

      await page.getByLabel("Search movements").fill("squat");
      expect(await names()).toEqual(expect.arrayContaining(["Back Squat", "Front Squat", "Goblet Squat"]));
      expect((await names()).every((name) => /squat/i.test(name))).toBe(true);
      await page.getByLabel("Search movements").clear();

      // The Legs tab: movements whose primary muscles are quads, hamstrings, glutes or calves.
      await page.getByRole("tab", { name: /^Legs/ }).click();
      expect(await names()).toEqual(expect.arrayContaining(["Standing Calf Raise", "Back Squat", "Romanian Deadlift"]));
      expect(await names()).not.toContain("Bench Press");

      await page.getByRole("tab", { name: /^All/ }).click();
      await page.getByLabel("Filter by equipment").selectOption({ label: "Kettlebell" });
      await expect(page.getByText("1 of ")).toBeVisible();
      expect(await names()).toEqual(["Kettlebell Swing"]);

      await page.getByLabel("Search movements").fill("zzzz");
      await expect(page.getByText("No movements match.")).toBeVisible();
    });

    test("should open a built-in movement and offer no way to change it", async ({ page }) => {
      await goTo(page, "Movements");
      await movementRow(page, "Bench Press").getByRole("link").click();

      await expect(page.getByRole("heading", { level: 1, name: "Bench Press" })).toBeVisible();
      await expect(page.getByRole("button", { name: /edit|delete|rename/i })).toHaveCount(0);
    });

    test("should show built-ins to every user, and each user's own movements only to them", async ({
      page,
      browser,
    }) => {
      await addMovement(page, "My Private Movement");

      const otherContext = await browser.newContext();
      const otherPage = await otherContext.newPage();
      await signUp(otherPage, newTestUser());
      await goTo(otherPage, "Movements");

      await expect(movementRow(otherPage, "Bench Press")).toBeVisible();
      await expect(otherPage.getByText("My Private Movement")).toHaveCount(0);
      await otherContext.close();
    });

    test("should keep one copy of each built-in however many accounts exist", async () => {
      const db = getDb();
      const copies = await db.movement.groupBy({ by: ["name"], where: { userId: null }, _count: true });
      expect(copies.length).toBeGreaterThanOrEqual(90);
      expect(copies.every((c) => c._count === 1)).toBe(true);
      // Every built-in has a key to upsert on, and at least one primary muscle.
      expect(await db.movement.count({ where: { userId: null, slug: null } })).toBe(0);
      expect(await db.movement.count({ where: { userId: null, primaryMuscles: { isEmpty: true } } })).toBe(0);
    });
  });

  test.describe("create your own", () => {
    test("should create a custom movement and list it as yours", async ({ page }) => {
      await addMovement(page, "Zercher Squat");

      await expect(movementRow(page, "Zercher Squat")).toContainText("Yours");
      // A failure would show a toast, so no toast means the server accepted it.
      await expect(toast(page)).toHaveCount(0);
      // It was saved, not only added to the page: a reload still lists it.
      await page.reload();
      await expect(movementRow(page, "Zercher Squat")).toBeVisible();
    });

    test("should clear the form after creating a movement", async ({ page }) => {
      await addMovement(page, "Sled Push");

      await expect(page.getByLabel("Movement name")).toHaveValue("");
      await expect(page.getByRole("button", { name: "Add", exact: true })).toBeDisabled();
    });

    test("should not allow a blank name", async ({ page }) => {
      await goTo(page, "Movements");
      await page.getByLabel("Movement name").fill("   ");

      await expect(page.getByRole("button", { name: "Add", exact: true })).toBeDisabled();
    });

    test("should reject a duplicate name and say why", async ({ page }) => {
      await addMovement(page, "Landmine Row");
      await page.getByLabel("Movement name").fill("Landmine Row");
      await page.getByRole("button", { name: "Add", exact: true }).click();

      await expect(toast(page)).toContainText("You already have a movement with this name");
      await expect(page.getByRole("listitem").filter({ hasText: "Landmine Row" })).toHaveCount(1);
    });

    test("should not let a custom movement take the name of a built-in", async ({ page }) => {
      await goTo(page, "Movements");
      // Any case: the library never lists two "Bench Press".
      await page.getByLabel("Movement name").fill("bench PRESS");
      await expect(page.getByText("Bench Press is already in the library.")).toBeVisible();
      await page.getByRole("button", { name: "Add", exact: true }).click();

      await expect(toast(page)).toContainText("Bench Press is already in the library");
      await expect(page.getByText("Yours")).toHaveCount(0);
      expect(
        await getDb().movement.count({
          where: { user: { isNot: null }, name: { equals: "bench press", mode: "insensitive" } },
        }),
      ).toBe(0);
    });

    test("should flag a custom body-weight movement", async ({ page }) => {
      await addMovement(page, "Weighted Chin Hang", { bodyWeight: true });
      await addMovement(page, "Cable Y-Raise");

      await expect(movementRow(page, "Weighted Chin Hang")).toContainText("Body weight");
      await expect(movementRow(page, "Cable Y-Raise")).not.toContainText("Body weight");
    });

    test("should show a user's movements in the Mine filter, sorted alphabetically", async ({ page }) => {
      // Added out of order on purpose.
      for (const name of ["Zottman Curl Hold", "Atlas Stone Lift", "Meadows Row Slow"]) await addMovement(page, name);

      await page.getByRole("button", { name: /^Mine/ }).click();
      const names = page.getByRole("list", { name: "Movements" }).getByRole("link");
      await expect(names).toHaveText(["Atlas Stone Lift", "Meadows Row Slow", "Zottman Curl Hold"]);
    });
  });

  test.describe("muscles", () => {
    test("should save a custom movement with its muscles and show them on its page", async ({ page }) => {
      await goTo(page, "Movements");
      await page.getByLabel("Movement name").fill("Cable Fly Low");
      // Tapping a muscle steps through primary, secondary, and not used.
      await page.getByRole("button", { name: "Chest: not used" }).click();
      await page.getByRole("button", { name: "Shoulders: not used" }).click();
      await page.getByRole("button", { name: "Shoulders: primary" }).click();
      await expect(page.getByRole("button", { name: "Chest: primary" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Shoulders: secondary" })).toBeVisible();
      await page.getByRole("button", { name: "Add", exact: true }).click();

      await expect(movementRow(page, "Cable Fly Low")).toContainText("Chest");
      await movementRow(page, "Cable Fly Low").getByRole("link").click();
      await expect(page.getByRole("list", { name: "Primary muscles" })).toHaveText("Chest");
      await expect(page.getByRole("list", { name: "Secondary muscles" })).toHaveText("Shoulders");
      await expect(page.locator("[data-muscle='chest'][data-role='primary']").first()).toBeVisible();
      await expect(page.locator("[data-muscle='shoulders'][data-role='secondary']").first()).toBeVisible();
    });

    test("should save a custom movement without muscles", async ({ page }) => {
      await addMovement(page, "Mystery Lift");
      await expect(movementRow(page, "Mystery Lift")).toContainText("No muscles set");
    });

    test("should refuse a muscle that is not in the list", async ({ page }) => {
      await goTo(page, "Movements");
      await page.getByLabel("Movement name").fill("Bad Muscle Lift");
      await page.getByRole("button", { name: "Chest: not used" }).click();
      // The form only offers the 14 groups, so send a request with another value the way an edited request would.
      await page.route("**/_serverFn/**", async (route) => {
        const body = route.request().postData();
        if (route.request().method() === "POST" && body?.includes("Bad Muscle Lift")) {
          await route.continue({ postData: body.replace('"chest"', '"bogus"') });
        } else await route.continue();
      });
      await page.getByRole("button", { name: "Add", exact: true }).click();

      await expect(toast(page)).toContainText("Invalid input");
      expect(await getDb().movement.count({ where: { name: "Bad Muscle Lift" } })).toBe(0);
    });
  });
});
