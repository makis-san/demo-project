import { request as playwrightRequest, type Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { getDb } from "./db";

// A browser decides `Sec-Fetch-Site` and `Origin` itself, and a page cannot change them. These tests send the same
// requests a hostile page would cause, by setting the headers by hand on the request, so the check is tested without
// needing a second site. The write used is "log out": it needs no input, so it works as the simplest POST that does
// something, and it is the only server function that a form from another site could send with a valid body.

/** Clicks Log out and keeps the URL of the server function the page called, without letting the call through. */
async function logoutUrl(page: Page) {
  let url = "";
  await page.route("**/_serverFn/**", (route) => {
    // Only the logout POST is stopped. The page makes other calls of its own, and failing those breaks it.
    if (route.request().method() !== "POST") return route.continue();
    url = route.request().url();
    return route.abort();
  });
  await page.getByRole("button", { name: "Log out" }).click();
  await expect.poll(() => url).not.toBe("");
  await page.unroute("**/_serverFn/**");
  return url;
}

// The header the app's own calls send. Without it the server answers a call with a 500 whatever the check says.
const asServerFn = { "x-tsr-serverfn": "true" };

async function sessionRows(email: string) {
  return getDb().session.count({ where: { user: { email } } });
}

test.describe("Writes from another origin", () => {
  for (const site of ["cross-site", "same-site"]) {
    test(`should refuse a POST with Sec-Fetch-Site ${site}, cookie included, and change nothing`, async ({
      page,
      user,
    }) => {
      const url = await logoutUrl(page);
      const before = await sessionRows(user.email);

      // page.request sends the browser's cookies, so this is the case the cookie's SameSite flag does not stop (same-site).
      const response = await page.request.post(url, { headers: { ...asServerFn, "sec-fetch-site": site } });

      expect(response.status()).toBe(403);
      expect(await sessionRows(user.email)).toBe(before);
      await page.reload();
      await expect(page).toHaveURL(/\/home/);
    });
  }

  test("should refuse a POST from a foreign Origin when there is no Sec-Fetch-Site", async ({ page, user }) => {
    const url = await logoutUrl(page);
    const before = await sessionRows(user.email);

    for (const origin of ["https://evil.example", "http://localhost:4000", "null"]) {
      const response = await page.request.post(url, { headers: { ...asServerFn, origin } });
      expect(response.status(), `Origin ${origin}`).toBe(403);
    }

    expect(await sessionRows(user.email)).toBe(before);
  });

  test("should refuse a POST with neither header when it carries the session cookie", async ({ page, user }) => {
    const url = await logoutUrl(page);

    const response = await page.request.post(url, { headers: asServerFn });

    expect(response.status()).toBe(403);
    expect(await sessionRows(user.email)).toBeGreaterThan(0);
  });

  test("should allow a POST with neither header when there is no cookie", async ({ page, baseURL }) => {
    // A script or a test tool, not a browser. There is no signed-in browser that could have been tricked.
    const url = await logoutUrl(page);
    const noCookie = await playwrightRequest.newContext({ baseURL });

    const response = await noCookie.post(url, { headers: asServerFn });

    expect(response.status()).toBe(200);
    await noCookie.dispose();
  });

  test("should allow a POST from the app's own origin", async ({ page, user, baseURL }) => {
    const url = await logoutUrl(page);
    const before = await sessionRows(user.email);

    // Both forms of "ours": the Fetch Metadata header, and the older Origin check for browsers without it.
    const sameOrigin = await page.request.post(url, { headers: { ...asServerFn, "sec-fetch-site": "same-origin" } });
    expect(sameOrigin.status()).toBe(200);
    expect(await sessionRows(user.email)).toBe(before - 1); // it went through and signed this browser out

    const ownOrigin = await page.request.post(url, { headers: { ...asServerFn, origin: baseURL! } });
    expect(ownOrigin.status()).toBe(200);
  });

  test("should not get in the way of the app: logging out from the page still works", async ({ page }) => {
    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page).toHaveURL(/\/sign-in/);
  });

  test("should leave reading pages alone, whatever the headers say", async ({ page }) => {
    // GET never changes anything here, so it is not checked.
    const response = await page.request.get("/home", { headers: { "sec-fetch-site": "cross-site" } });
    expect(response.status()).toBe(200);
  });
});
