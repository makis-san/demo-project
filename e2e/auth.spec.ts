import { createHash, randomBytes } from "node:crypto";
import { test as base, expect, request, type BrowserContext, type Page } from "@playwright/test";
import { getDb } from "./db";
import { gotoApp, newTestUser, signUp, submitSignIn, type TestUser } from "./fixtures";

// These tests use plain pages. The `page` from ./fixtures is already signed in, and here the sign-up and
// sign-in forms and the cookie are what is being tested.
const test = base.extend<{ freshPage: () => Promise<Page> }>({
  // Every call is a new browser profile: no cookies, so nothing is signed in. They are closed after the test.
  freshPage: async ({ browser }, use) => {
    const contexts: BrowserContext[] = [];
    await use(async () => {
      const context = await browser.newContext();
      contexts.push(context);
      return context.newPage();
    });
    await Promise.all(contexts.map((context) => context.close()));
  },
});

async function sessionCookie(page: Page) {
  const cookie = (await page.context().cookies()).find((c) => c.name === "session");
  expect(cookie, "the session cookie").toBeDefined();
  return cookie!;
}

/** A browser that has signed in with the form, as a person coming back would. */
async function signedInPage(freshPage: () => Promise<Page>, user: TestUser) {
  const page = await freshPage();
  await submitSignIn(page, user.email, user.password);
  await expect(page).toHaveURL(/\/current-workout/);
  return page;
}

async function createUser(freshPage: () => Promise<Page>) {
  const user = newTestUser();
  await signUp(await freshPage(), user);
  return user;
}

test.describe("Email addresses", () => {
  test("should not create a second account for the same email in another case", async ({ freshPage }) => {
    const user = await createUser(freshPage);

    const page = await freshPage();
    await gotoApp(page, "/create-account");
    await page.getByLabel("Name").fill("Someone Else");
    await page.getByLabel("Email").fill(user.email.toUpperCase());
    await page.getByLabel("Password").fill("Another-Password-1");
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(page.getByText("An account with this email already exists")).toBeVisible();
    await expect(page).toHaveURL(/\/create-account/);
  });

  test("should sign in to the same account with the email in uppercase", async ({ freshPage }) => {
    const user = await createUser(freshPage);

    const page = await freshPage();
    await submitSignIn(page, user.email.toUpperCase(), user.password);
    await expect(page).toHaveURL(/\/current-workout/);
    await expect(page.getByText(user.name)).toBeVisible();
  });
});

test.describe("Sign in and sign out", () => {
  test("should sign in with the right password", async ({ freshPage }) => {
    const user = await createUser(freshPage);

    const page = await signedInPage(freshPage, user);
    await expect(page.getByText(user.name)).toBeVisible();
  });

  test("should give the same answer for a wrong password and an unknown email", async ({ freshPage }) => {
    const user = await createUser(freshPage);

    const wrongPassword = await freshPage();
    await submitSignIn(wrongPassword, user.email, "Not-The-Password-1");
    await expect(wrongPassword.getByText("Invalid email or password")).toBeVisible();
    await expect(wrongPassword).toHaveURL(/\/sign-in/);

    const unknownEmail = await freshPage();
    await submitSignIn(unknownEmail, newTestUser().email, "Not-The-Password-1");
    await expect(unknownEmail.getByText("Invalid email or password")).toBeVisible();
    await expect(unknownEmail).toHaveURL(/\/sign-in/);
  });

  test("should send a signed-out visitor to the sign-in page", async ({ freshPage }) => {
    const page = await freshPage();
    await page.goto("/movements");
    await expect(page).toHaveURL(/\/sign-in/);
  });

  test("should sign out and then refuse the protected pages", async ({ freshPage }) => {
    const user = await createUser(freshPage);
    const page = await signedInPage(freshPage, user);

    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page).toHaveURL(/\/sign-in/);
    expect((await page.context().cookies()).find((c) => c.name === "session")).toBeUndefined();

    await page.goto("/current-workout");
    await expect(page).toHaveURL(/\/sign-in/);
  });
});

test.describe("Sessions", () => {
  test("should stop a copied token from working after the user signs out", async ({ freshPage }) => {
    const user = await createUser(freshPage);
    const page = await signedInPage(freshPage, user);
    const token = await sessionCookie(page);

    // A second browser that holds a copy of the cookie, the way a stolen one would be used.
    const thief = await freshPage();
    await thief.context().addCookies([token]);
    await thief.goto("/current-workout");
    await expect(thief).toHaveURL(/\/current-workout/);

    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page).toHaveURL(/\/sign-in/);

    await thief.goto("/current-workout");
    await expect(thief).toHaveURL(/\/sign-in/);
  });

  test("should refuse a session after it has expired", async ({ freshPage }) => {
    const user = await createUser(freshPage);
    const page = await signedInPage(freshPage, user);
    await page.reload();
    await expect(page).toHaveURL(/\/current-workout/);

    // The cookie is still in the browser. Only the stored expiry changes.
    const { count } = await getDb().session.updateMany({
      where: { user: { email: user.email } },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect(count).toBeGreaterThan(0);

    await page.reload();
    await expect(page).toHaveURL(/\/sign-in/);
  });

  test("should give each sign-in its own token, and keep it away from page scripts", async ({ freshPage }) => {
    const user = await createUser(freshPage);
    const first = await signedInPage(freshPage, user);
    const second = await signedInPage(freshPage, user);
    const firstToken = await sessionCookie(first);
    const secondToken = await sessionCookie(second);

    expect(firstToken.value).not.toBe(secondToken.value);
    expect(firstToken.httpOnly).toBe(true);
    expect(firstToken.sameSite).toBe("Lax");
    expect(await first.evaluate(() => document.cookie)).not.toContain("session=");
  });

  test("should only sign out the browser that logged out", async ({ freshPage }) => {
    const user = await createUser(freshPage);
    const laptop = await signedInPage(freshPage, user);
    const phone = await signedInPage(freshPage, user);

    await laptop.getByRole("button", { name: "Log out" }).click();
    await expect(laptop).toHaveURL(/\/sign-in/);

    await phone.reload();
    await expect(phone).toHaveURL(/\/current-workout/);
  });

  test("should store only a hash of the token", async ({ freshPage }) => {
    const user = await createUser(freshPage);
    const page = await signedInPage(freshPage, user);
    const { value } = await sessionCookie(page);

    const sessions = await getDb().session.findMany({ where: { user: { email: user.email } } });
    const hashes = sessions.map((session) => session.tokenHash);
    expect(hashes).toContain(createHash("sha256").update(value).digest("hex"));
    expect(hashes).not.toContain(value);
  });

  test("should treat a cookie from before sessions existed as signed out", async ({ freshPage, baseURL }) => {
    // The old format was `<user id>.<signature>`. Such a cookie is simply not in the table.
    const user = await createUser(freshPage);
    const userId = (await getDb().user.findUniqueOrThrow({ where: { email: user.email } })).id;
    const page = await freshPage();
    await page.context().addCookies([
      {
        name: "session",
        value: `${userId}.${randomBytes(32).toString("hex")}`,
        url: baseURL!,
      },
    ]);
    await page.goto("/current-workout");
    await expect(page).toHaveURL(/\/sign-in/);
  });

  test("should answer protected server functions with a redirect when there is no session", async ({
    freshPage,
    baseURL,
  }) => {
    const user = await createUser(freshPage);

    // Sign in and note every server function call that loading the current workout page makes.
    const page = await freshPage();
    const urls: string[] = [];
    page.on("request", (req) => {
      if (req.url().includes("/_serverFn/") && req.method() === "GET") urls.push(req.url());
    });
    await submitSignIn(page, user.email, user.password);
    await expect(page).toHaveURL(/\/current-workout/);
    await expect(page.getByRole("heading", { level: 1, name: "Current Workout" })).toBeVisible();
    expect(urls.length).toBeGreaterThan(0);

    const headers = { "x-tsr-serverfn": "true" };
    const noSession = await request.newContext({ baseURL });
    let redirected = 0;
    for (const url of urls) {
      const without = await (await noSession.get(url, { headers })).text();
      if (!without.includes("isSerializedRedirect")) continue; // the user and timezone calls are public
      redirected++;
      const withSession = await (await page.request.get(url, { headers })).text();
      expect(withSession).not.toContain("isSerializedRedirect");
    }
    await noSession.dispose();
    expect(redirected, "protected calls that redirected").toBeGreaterThan(0);
  });
});

test.describe("Rate limit", () => {
  const wrong = "Invalid email or password";
  const refused = "Too many attempts";

  /** Submits the sign-in form and waits for the server's answer, so the message on screen is the new one. */
  async function attempt(page: Page, password: string) {
    await page.getByLabel("Password").fill(password);
    const answered = page.waitForResponse(
      (res) => res.request().method() === "POST" && res.url().includes("/_serverFn/"),
    );
    await page.getByRole("button", { name: "Sign in" }).click();
    await answered;
  }

  test("should refuse the sixth sign-in for one email and leave other users alone", async ({ freshPage }) => {
    const locked = await createUser(freshPage);
    const other = await createUser(freshPage);

    const page = await freshPage();
    await gotoApp(page, "/sign-in");
    await page.getByLabel("Email").fill(locked.email);

    for (let i = 0; i < 5; i++) {
      await attempt(page, `Wrong-password-${i}`);
      await expect(page.getByText(wrong)).toBeVisible();
    }

    // Even the right password is refused now.
    await attempt(page, locked.password);
    await expect(page.getByText(refused)).toBeVisible();
    await expect(page).toHaveURL(/\/sign-in/);

    // Someone else, from the same address, signs in as usual.
    const otherPage = await signedInPage(freshPage, other);
    await expect(otherPage.getByText(other.name)).toBeVisible();
  });

  test("should answer an unknown email the same way as a known one", async ({ freshPage }) => {
    // The limit applies to the typed email, not to whether it has an account, so the answer reveals nothing.
    const page = await freshPage();
    await gotoApp(page, "/sign-in");
    await page.getByLabel("Email").fill(newTestUser().email);

    for (let i = 0; i < 5; i++) {
      await attempt(page, `Wrong-password-${i}`);
      await expect(page.getByText(wrong)).toBeVisible();
    }
    await attempt(page, "Wrong-password-6");
    await expect(page.getByText(refused)).toBeVisible();
  });

  test("should not count successful sign-ins", async ({ freshPage }) => {
    const user = await createUser(freshPage);
    for (let i = 0; i < 7; i++) await signedInPage(freshPage, user);
  });
});
