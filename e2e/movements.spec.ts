import { test, expect, newTestUser, signUp } from "./fixtures";
import { addMovement, goTo } from "./helpers";

test.describe("Movements", () => {
  test.describe("create", () => {
    test("should create a new movement with a valid name", async ({ page }) => {
      await addMovement(page, "Back Squat");

      await expect(page.getByRole("listitem")).toHaveCount(1);
      // A failure would show a toast, so no toast means the server accepted it.
      await expect(page.locator(".Toastify__toast")).toHaveCount(0);
    });

    test("should show the new movement in the movements list", async ({ page }) => {
      await goTo(page, "Movements");
      await expect(page.getByText("No movements yet. Add one above!")).toBeVisible();

      await addMovement(page, "Bench Press");
      await expect(page.getByText("No movements yet")).toHaveCount(0);

      // It was saved, not only added to the page: a reload still lists it.
      await page.reload();
      await expect(page.getByRole("listitem").filter({ hasText: "Bench Press" })).toBeVisible();
    });

    test("should clear the input after creating a movement", async ({ page }) => {
      await addMovement(page, "Deadlift");

      await expect(page.getByLabel("Movement name")).toHaveValue("");
      await expect(page.getByRole("button", { name: "Add", exact: true })).toBeDisabled();
    });

    test("should not allow a blank name", async ({ page }) => {
      await goTo(page, "Movements");
      await page.getByLabel("Movement name").fill("   ");

      await expect(page.getByRole("button", { name: "Add", exact: true })).toBeDisabled();
    });

    test("should reject a duplicate name and say why", async ({ page }) => {
      await addMovement(page, "Overhead Press");
      await page.getByLabel("Movement name").fill("Overhead Press");
      await page.getByRole("button", { name: "Add", exact: true }).click();

      await expect(page.locator(".Toastify__toast")).toContainText("You already have a movement with this name");
      await expect(page.getByRole("listitem")).toHaveCount(1);
    });

    test("should flag a body-weight movement", async ({ page }) => {
      await addMovement(page, "Pull-up", { bodyWeight: true });
      await addMovement(page, "Bench Press");

      await expect(page.getByRole("listitem").filter({ hasText: "Pull-up" })).toContainText("Body weight");
      await expect(page.getByRole("listitem").filter({ hasText: "Bench Press" })).not.toContainText("Body weight");
    });
  });

  test.describe("read", () => {
    test("should display all movements on the movements page", async ({ page }) => {
      const names = ["Bench Press", "Back Squat", "Dumbbell Curl"];
      for (const name of names) await addMovement(page, name);

      // Exactly these three: movements belong to the user, so nothing from other tests shows up.
      await expect(page.getByRole("listitem")).toHaveCount(3);
      for (const name of names) {
        await expect(page.getByRole("listitem").filter({ hasText: name })).toBeVisible();
      }
    });

    test("should show movements sorted alphabetically", async ({ page }) => {
      // Added out of order on purpose.
      for (const name of ["Squat", "Bench Press", "Deadlift", "Curl"]) await addMovement(page, name);

      await expect(page.getByRole("listitem")).toHaveText(["Bench Press", "Curl", "Deadlift", "Squat"]);
    });

    test("should not show another user's movements", async ({ page, browser }) => {
      await addMovement(page, "My Private Movement");

      const otherContext = await browser.newContext();
      const otherPage = await otherContext.newPage();
      await signUp(otherPage, newTestUser());
      await goTo(otherPage, "Movements");

      await expect(otherPage.getByText("No movements yet. Add one above!")).toBeVisible();
      await expect(otherPage.getByText("My Private Movement")).toHaveCount(0);
      await otherContext.close();
    });
  });
});
