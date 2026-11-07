import { expect, test } from "@playwright/test";
import { gotoApp, newTestUser, signUp, submitSignIn } from "./fixtures";

// These tests use a plain page. The `page` from ./fixtures is already signed in, and here the sign-up and
// sign-in forms are what is being tested.

test.describe("Email addresses", () => {
  test("should not create a second account for the same email in another case", async ({ browser, page }) => {
    const user = newTestUser();
    await signUp(page, user);

    // A second browser, so it is not already signed in and sent away from the form.
    const other = await (await browser.newContext()).newPage();
    await gotoApp(other, "/create-account");
    await other.getByLabel("Name").fill("Someone Else");
    await other.getByLabel("Email").fill(user.email.toUpperCase());
    await other.getByLabel("Password").fill("Another-Password-1");
    await other.getByRole("button", { name: "Create account" }).click();

    await expect(other.getByText("An account with this email already exists")).toBeVisible();
    await expect(other).toHaveURL(/\/create-account/);
    await other.context().close();
  });

  test("should sign in to the same account with the email in uppercase", async ({ browser, page }) => {
    const user = newTestUser();
    await signUp(page, user);

    const context = await browser.newContext();
    const other = await context.newPage();
    await submitSignIn(other, user.email.toUpperCase(), user.password);
    await expect(other).toHaveURL(/\/current-workout/);
    await expect(other.getByText(user.name)).toBeVisible();
    await context.close();
  });
});
