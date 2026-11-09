import { test, expect, gotoApp, submitSignIn } from "./fixtures";
import { getDb, seedCompletedWorkouts } from "./db";
import { deleteUserAndData } from "../src/lib/account.server";
import type { Browser, Page } from "@playwright/test";

const newPassword = "A-new-password-42";

/** Another browser profile signed in as the same user. */
async function otherDevice(browser: Browser, email: string, password: string) {
  const page = await (await browser.newContext()).newPage();
  await submitSignIn(page, email, password);
  await expect(page).toHaveURL(/\/home/);
  return page;
}

async function changePassword(page: Page, current: string, next: string) {
  await page.getByLabel("Current password").fill(current);
  await page.getByLabel("New password").fill(next);
  await page.getByRole("button", { name: "Change password" }).click();
}

async function passwordHashOf(email: string) {
  return (await getDb().user.findUniqueOrThrow({ where: { email } })).passwordHash;
}

test.describe("Change password", () => {
  test("should make the old password fail and the new one work, and sign the other devices out", async ({
    page,
    user,
    browser,
  }) => {
    const other = await otherDevice(browser, user.email, user.password);
    await gotoApp(page, "/account");

    await changePassword(page, user.password, newPassword);

    await expect(page.getByRole("status")).toContainText("Password changed. 1 other device was signed out.");
    // This browser stays signed in, the other one is out on its next request.
    await page.reload();
    await expect(page).toHaveURL(/\/account/);
    await other.reload();
    await expect(other).toHaveURL(/\/sign-in/);
    expect(await getDb().session.count({ where: { user: { email: user.email } } })).toBe(1);

    const oldPassword = await (await browser.newContext()).newPage();
    await submitSignIn(oldPassword, user.email, user.password);
    await expect(oldPassword.getByText("Invalid email or password")).toBeVisible();

    const fresh = await (await browser.newContext()).newPage();
    await submitSignIn(fresh, user.email, newPassword);
    await expect(fresh).toHaveURL(/\/home/);
  });

  test("should refuse a wrong current password and change nothing", async ({ page, user, browser }) => {
    const other = await otherDevice(browser, user.email, user.password);
    const before = await passwordHashOf(user.email);
    await gotoApp(page, "/account");

    await changePassword(page, "Not-the-password-1", newPassword);

    await expect(page.getByRole("alert")).toContainText("That password is not right");
    expect(await passwordHashOf(user.email)).toBe(before);
    await other.reload();
    await expect(other).toHaveURL(/\/home/);
  });

  test("should refuse a new password shorter than 8 characters, in the page and on the server", async ({
    page,
    user,
  }) => {
    const before = await passwordHashOf(user.email);
    await gotoApp(page, "/account");
    await page.getByLabel("Current password").fill(user.password);
    await page.getByLabel("New password").fill("1234567");
    await page.getByRole("button", { name: "Change password" }).click();
    expect(await page.getByLabel("New password").evaluate((input: HTMLInputElement) => input.validity.tooShort)).toBe(
      true,
    );

    // Past the browser's check, the server says no too.
    await page.getByLabel("New password").evaluate((input: HTMLInputElement) => input.removeAttribute("minlength"));
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(page.getByRole("alert")).toContainText("Invalid input");
    expect(await passwordHashOf(user.email)).toBe(before);
  });

  test("should count wrong guesses like sign-in does, and stop after five", async ({ page, user }) => {
    await gotoApp(page, "/account");
    for (let i = 0; i < 5; i++) {
      await changePassword(page, `Wrong-guess-${i}`, newPassword);
      await expect(page.getByRole("alert")).toContainText("That password is not right");
    }

    // Even the right password is refused now.
    await changePassword(page, user.password, newPassword);
    await expect(page.getByRole("alert")).toContainText("Too many attempts");
  });
});

test.describe("Delete account", () => {
  async function openConfirmation(page: Page) {
    await gotoApp(page, "/account");
    await page.getByRole("button", { name: "Delete account" }).click();
    return page.getByRole("group", { name: "Confirm account deletion" });
  }

  /** What the user has in the database, by table. All of it is zero after the account is deleted. */
  async function rowsOf(email: string) {
    const db = getDb();
    const user = await db.user.findUnique({ where: { email } });
    if (!user) return { user: 0, sessions: 0, workouts: 0, sets: 0, bodyWeights: 0 };
    return {
      user: 1,
      sessions: await db.session.count({ where: { userId: user.id } }),
      workouts: await db.workout.count({ where: { userId: user.id } }),
      sets: await db.set.count({ where: { workout: { userId: user.id } } }),
      bodyWeights: await db.bodyWeight.count({ where: { userId: user.id } }),
    };
  }

  test("should ask for confirmation in the page first, and do nothing until it is given", async ({ page, user }) => {
    // A native confirm() would block the test, so one showing up fails it.
    page.on("dialog", () => {
      throw new Error("The page opened a browser dialog");
    });

    const confirmation = await openConfirmation(page);
    await expect(confirmation).toBeVisible();
    await expect(confirmation.getByRole("button", { name: "Delete everything" })).toBeVisible();
    expect((await rowsOf(user.email)).user).toBe(1);

    await confirmation.getByRole("button", { name: "Cancel" }).click();
    await expect(confirmation).toHaveCount(0);
    expect((await rowsOf(user.email)).user).toBe(1);
  });

  test("should refuse a wrong password and delete nothing", async ({ page, user }) => {
    await seedCompletedWorkouts(user.email, [
      { completedAt: new Date(), sets: [{ movement: "Bench Press", weight: 100, reps: 5 }] },
    ]);
    const before = await rowsOf(user.email);
    const confirmation = await openConfirmation(page);

    await confirmation.getByLabel("Password").fill("Not-the-password-1");
    await confirmation.getByRole("button", { name: "Delete everything" }).click();

    await expect(confirmation.getByRole("alert")).toContainText("That password is not right");
    await expect(page).toHaveURL(/\/account/);
    expect(await rowsOf(user.email)).toEqual(before);
  });

  test("should delete the account and all its data, sign out, and refuse a new sign-in", async ({
    page,
    user,
    browser,
  }) => {
    await seedCompletedWorkouts(user.email, [
      { completedAt: new Date(Date.now() - 86400_000), sets: [{ movement: "Bench Press", weight: 100, reps: 5 }] },
      { completedAt: new Date(), sets: [{ movement: "My own lift", weight: 50, reps: 8 }] },
    ]);
    const { id } = await getDb().user.findUniqueOrThrow({ where: { email: user.email } });
    await getDb().bodyWeight.create({ data: { userId: id, weight: 180 } });
    const other = await otherDevice(browser, user.email, user.password);
    const before = await rowsOf(user.email);
    expect(before).toMatchObject({ user: 1, workouts: 2, sets: 2, bodyWeights: 1 });
    expect(before.sessions).toBe(2);

    const confirmation = await openConfirmation(page);
    await confirmation.getByLabel("Password").fill(user.password);
    await confirmation.getByRole("button", { name: "Delete everything" }).click();

    await expect(page).toHaveURL(/\/sign-in/);
    expect((await page.context().cookies()).find((c) => c.name === "session")).toBeUndefined();
    expect(await rowsOf(user.email)).toEqual({ user: 0, sessions: 0, workouts: 0, sets: 0, bodyWeights: 0 });
    expect(await getDb().movement.count({ where: { userId: id } })).toBe(0);

    // The other device is out, and the credentials no longer work.
    await other.reload();
    await expect(other).toHaveURL(/\/sign-in/);
    const again = await (await browser.newContext()).newPage();
    await submitSignIn(again, user.email, user.password);
    await expect(again.getByText("Invalid email or password")).toBeVisible();
  });
});

test.describe("deleteUserAndData transaction limit", () => {
  test("should roll everything back when the transaction runs past its limit", async ({ user, page: _signedUp }) => {
    // The page fixture is what creates the user.
    const workouts = Array.from({ length: 300 }, (_, i) => ({
      completedAt: new Date(Date.now() - (i + 1) * 3600_000),
      sets: [{ movement: "Bench Press", weight: 100, reps: 5 }],
    }));
    await seedCompletedWorkouts(user.email, workouts);
    const db = getDb();
    const { id } = await db.user.findUniqueOrThrow({ where: { email: user.email } });

    // The limit is passed on to Prisma: 1 ms is not enough for six statements, and nothing is left half deleted.
    await expect(deleteUserAndData(db, id, { timeoutMs: 1 })).rejects.toThrow();
    expect(await db.workout.count({ where: { userId: id } })).toBe(300);
    expect(await db.user.count({ where: { id } })).toBe(1);

    // With the default limit the same call works.
    const removed = await deleteUserAndData(db, id);
    expect(removed.workouts).toBe(300);
  });
});
