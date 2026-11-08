import { randomUUID } from "node:crypto";
import { test as base, expect, type Page } from "@playwright/test";

export type TestUser = { name: string; email: string; password: string };

export function newTestUser(): TestUser {
  const id = randomUUID().slice(0, 8);
  return { name: `Tester ${id}`, email: `e2e-${id}-${Date.now()}@example.com`, password: "Password-123" };
}

/**
 * Waits until React has attached to the page. With the dev server the HTML
 * arrives before the scripts, and text typed into a field before hydration is
 * wiped when React takes over, so interact with the page only after this.
 */
export async function waitForHydration(page: Page) {
  await page.waitForFunction(() => {
    const element = document.querySelector("input, button, a");
    return !!element && Object.keys(element).some((key) => key.startsWith("__reactProps"));
  });
}

/** Full page load of a path, then wait for hydration. */
export async function gotoApp(page: Page, path: string) {
  await page.goto(path);
  await waitForHydration(page);
}

/** Creates the account through the real sign-up form. The page ends up signed in on the current workout page. */
export async function signUp(page: Page, user: TestUser) {
  await gotoApp(page, "/create-account");
  await page.getByLabel("Name").fill(user.name);
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/current-workout/);
  await waitForHydration(page);
}

/** Fills in the sign-in form and submits it. Does not wait for the result, the caller decides what to expect. */
export async function submitSignIn(page: Page, email: string, password: string) {
  await gotoApp(page, "/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

/**
 * Every test gets its own brand new user, signed in. Tests never share data,
 * so they can run in parallel and need no clean-up.
 */
export const test = base.extend<{ user: TestUser }>({
  user: async ({}, use) => {
    await use(newTestUser());
  },
  page: async ({ page, user }, use) => {
    await signUp(page, user);
    await use(page);
  },
});

export { expect };
