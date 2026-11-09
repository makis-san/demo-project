import { createHash } from "node:crypto";
import { test, expect, gotoApp, newTestUser, signUp, submitSignIn, type TestUser } from "./fixtures";
import { getDb } from "./db";
import { deviceLabel } from "../src/lib/device-label";
import type { Browser, Page } from "@playwright/test";

const hour = 3600_000;
const day = 24 * hour;

const iPhone =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

/** Another browser profile signed in as the same user. */
async function otherDevice(browser: Browser, user: TestUser, userAgent?: string) {
  const context = await browser.newContext({ userAgent });
  const page = await context.newPage();
  await submitSignIn(page, user.email, user.password);
  await expect(page).toHaveURL(/\/home/);
  return page;
}

async function sessionOf(page: Page) {
  const cookie = (await page.context().cookies()).find((c) => c.name === "session")!;
  const tokenHash = createHash("sha256").update(cookie.value).digest("hex");
  return { cookie, row: await getDb().session.findUniqueOrThrow({ where: { tokenHash } }), tokenHash };
}

test.describe("Account page: sessions", () => {
  test("should list this device and the others, and offer to sign out only the others", async ({
    page,
    user,
    browser,
  }) => {
    await otherDevice(browser, user, iPhone);
    await gotoApp(page, "/account");

    const devices = page.getByRole("list", { name: "Signed-in devices" }).getByRole("listitem");
    await expect(devices).toHaveCount(2);
    await expect(devices.first()).toContainText("This device");
    await expect(devices.first().getByRole("button")).toHaveCount(0);
    await expect(devices.nth(1)).toContainText("Safari on iOS");
    await expect(devices.nth(1).getByRole("button", { name: "Sign out Safari on iOS" })).toBeVisible();
  });

  test("should sign the other browser out when it is revoked from the Account page", async ({
    page,
    user,
    browser,
  }) => {
    const other = await otherDevice(browser, user, iPhone);
    await other.goto("/movements");
    await expect(other).toHaveURL(/\/movements/);

    await gotoApp(page, "/account");
    await page.getByRole("button", { name: "Sign out Safari on iOS" }).click();
    await expect(page.getByRole("listitem").filter({ hasText: "Safari on iOS" })).toHaveCount(0);

    // Its next request goes to the sign-in page, and this browser is still signed in.
    await other.reload();
    await expect(other).toHaveURL(/\/sign-in/);
    await page.reload();
    await expect(page).toHaveURL(/\/account/);
    expect(await getDb().session.count({ where: { user: { email: user.email } } })).toBe(1);
  });

  test("should sign out every other browser at once and keep this one", async ({ page, user, browser }) => {
    const second = await otherDevice(browser, user);
    const third = await otherDevice(browser, user);
    await gotoApp(page, "/account");
    await expect(page.getByRole("list", { name: "Signed-in devices" }).getByRole("listitem")).toHaveCount(3);

    await page.getByRole("button", { name: "Sign out all other devices" }).click();
    await expect(page.getByRole("list", { name: "Signed-in devices" }).getByRole("listitem")).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Sign out all other devices" })).toBeDisabled();

    for (const other of [second, third]) {
      await other.reload();
      await expect(other).toHaveURL(/\/sign-in/);
    }
    await page.reload();
    await expect(page).toHaveURL(/\/account/);
  });

  test("should not let one user sign out another user's device", async ({ page, user, browser }) => {
    const stranger = newTestUser();
    await signUp(await (await browser.newContext()).newPage(), stranger);
    const victim = await getDb().session.findFirstOrThrow({ where: { user: { email: stranger.email } } });

    // Press "Sign out" for one of this user's own devices once, keeping the request instead of sending it.
    const mine = await otherDevice(browser, user, iPhone);
    const mineId = (await sessionOf(mine)).row.id;
    await gotoApp(page, "/account");
    let url = "";
    let body = "";
    await page.route("**/_serverFn/**", (route) => {
      if (route.request().method() !== "POST") return route.continue();
      url = route.request().url();
      body = route.request().postData() ?? "";
      return route.abort();
    });
    await page.getByRole("button", { name: "Sign out Safari on iOS" }).click();
    await expect.poll(() => url).not.toBe("");
    await page.unroute("**/_serverFn/**");
    expect(body).toContain(mineId);

    // The same request with the other user's session id in it.
    const headers = { "x-tsr-serverfn": "true", "content-type": "application/json", "sec-fetch-site": "same-origin" };
    const response = await page.request.post(url, { headers, data: body.replace(mineId, victim.id) });

    expect(await response.text()).toContain("already signed out");
    expect(await getDb().session.count({ where: { id: victim.id } })).toBe(1);
    expect(await getDb().session.count({ where: { id: mineId } })).toBe(1);
  });

  test("should show the browser and system the user agent names", async () => {
    expect(
      deviceLabel("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0 Safari/537.36"),
    ).toBe("Chrome on macOS");
    expect(
      deviceLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36 Edg/120.0"),
    ).toBe("Edge on Windows");
    expect(deviceLabel("Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0")).toBe(
      "Firefox on Linux",
    );
    expect(
      deviceLabel("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36"),
    ).toBe("Chrome on Android");
    expect(deviceLabel(iPhone)).toBe("Safari on iOS");
    expect(deviceLabel("curl/8.0")).toBe("Unknown device");
    expect(deviceLabel(undefined)).toBe("Unknown device");
  });
});

test.describe("Session lifetime", () => {
  test("should slide the expiry forward on a page load, and send the cookie again with the new date", async ({
    page,
  }) => {
    const { row, tokenHash } = await sessionOf(page);
    // Last written 2 hours ago and about to expire.
    await getDb().session.update({
      where: { tokenHash },
      data: { lastSeenAt: new Date(Date.now() - 2 * hour), expiresAt: new Date(Date.now() + day) },
    });

    await page.reload();
    await expect(page).toHaveURL(/\/home/);

    const after = await getDb().session.findUniqueOrThrow({ where: { tokenHash } });
    expect(after.expiresAt.getTime()).toBeGreaterThan(Date.now() + 6.9 * day);
    expect(after.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 7 * day);
    expect(Date.now() - after.lastSeenAt.getTime()).toBeLessThan(60_000);
    expect(after.createdAt).toEqual(row.createdAt);
    const cookie = (await page.context().cookies()).find((c) => c.name === "session")!;
    expect(cookie.expires * 1000).toBeGreaterThan(Date.now() + 6.9 * day);
  });

  test("should write at most once an hour", async ({ page }) => {
    const { tokenHash } = await sessionOf(page);
    const tenMinutesAgo = new Date(Date.now() - 10 * 60_000);
    const soon = new Date(Date.now() + day);
    await getDb().session.update({ where: { tokenHash }, data: { lastSeenAt: tenMinutesAgo, expiresAt: soon } });

    await page.reload();
    await page.goto("/movements");
    await expect(page).toHaveURL(/\/movements/);

    const after = await getDb().session.findUniqueOrThrow({ where: { tokenHash } });
    expect(after.lastSeenAt).toEqual(tenMinutesAgo);
    expect(after.expiresAt).toEqual(soon);
  });

  test("should never slide past 30 days from sign-in", async ({ page }) => {
    const { tokenHash } = await sessionOf(page);
    const createdAt = new Date(Date.now() - 29 * day);
    await getDb().session.update({
      where: { tokenHash },
      data: { createdAt, lastSeenAt: new Date(Date.now() - 2 * hour), expiresAt: new Date(Date.now() + day) },
    });

    await page.reload();
    await expect(page).toHaveURL(/\/home/);

    const after = await getDb().session.findUniqueOrThrow({ where: { tokenHash } });
    expect(after.expiresAt.getTime()).toBe(createdAt.getTime() + 30 * day);
  });

  test("should refuse a session older than 30 days even though its expiry is in the future", async ({ page }) => {
    const { tokenHash } = await sessionOf(page);
    await getDb().session.update({
      where: { tokenHash },
      data: { createdAt: new Date(Date.now() - 31 * day), expiresAt: new Date(Date.now() + 5 * day) },
    });

    await page.reload();

    await expect(page).toHaveURL(/\/sign-in/);
  });

  test("should still refuse a session that has expired", async ({ page }) => {
    const { tokenHash } = await sessionOf(page);
    await getDb().session.update({ where: { tokenHash }, data: { expiresAt: new Date(Date.now() - 1000) } });

    await page.reload();

    await expect(page).toHaveURL(/\/sign-in/);
  });

  test("should name the device from the user agent when signing in", async ({ browser, user, page }) => {
    await otherDevice(browser, user, iPhone);
    const labels = (await getDb().session.findMany({ where: { user: { email: user.email } } })).map(
      (s) => s.deviceLabel,
    );
    expect(labels).toContain("Safari on iOS");
    expect(page).toBeTruthy();
  });
});
