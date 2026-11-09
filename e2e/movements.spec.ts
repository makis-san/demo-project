import { test, expect, newTestUser, signUp } from "./fixtures";
import { getDb } from "./db";
import { addMovement, goTo, movementRow } from "./helpers";

const toast = (page: import("@playwright/test").Page) => page.locator(".Toastify__toast");

test.describe("Movements", () => {
  test.describe("library", () => {
    test("should give a new account the built-in movements without creating anything", async ({ page }) => {
      await goTo(page, "Movements");

      // About a hundred, and the common lifts are in them.
      const total = await page
        .getByRole("list", { name: /^Movements starting with/ })
        .getByRole("listitem")
        .count();
      expect(total).toBeGreaterThanOrEqual(90);
      await expect(movementRow(page, "Bench Press")).toBeVisible();
      await expect(movementRow(page, "Back Squat")).toBeVisible();
      await expect(movementRow(page, "Pull-Up")).toContainText("Body weight");
      await expect(movementRow(page, "Bench Press")).not.toContainText("Body weight");
      await expect(page.getByText("Yours")).toHaveCount(0);
    });

    test("should find movements by name, muscle and equipment", async ({ page }) => {
      await goTo(page, "Movements");
      const names = () =>
        page
          .getByRole("list", { name: /^Movements starting with/ })
          .getByRole("link")
          .allTextContents();

      await page.getByLabel("Search movements").fill("squat");
      expect(await names()).toEqual(expect.arrayContaining(["Back Squat", "Front Squat", "Goblet Squat"]));
      expect((await names()).every((name) => /squat/i.test(name))).toBe(true);
      await page.getByLabel("Search movements").clear();

      // Calves are trained by the calf raises, and by some other movements as a secondary muscle.
      await page.getByLabel("Filter by muscle").selectOption({ label: "Calves" });
      expect(await names()).toEqual(expect.arrayContaining(["Standing Calf Raise", "Seated Calf Raise", "Back Squat"]));
      expect(await names()).not.toContain("Bench Press");

      await page.getByLabel("Filter by muscle").selectOption({ label: "Any muscle" });
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
      const names = page.getByRole("list", { name: /^Movements starting with/ }).getByRole("link");
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
