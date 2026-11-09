import { test as base, expect, type Page } from "@playwright/test";
import { test, gotoApp } from "./fixtures";

function nonceOf(csp: string) {
  return /'nonce-([^']+)'/.exec(csp)?.[1];
}

base.describe("Security headers", () => {
  base("should be on a page for a visitor who is not signed in", async ({ request }) => {
    const response = await request.get("/sign-in");
    const headers = response.headers();

    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  });

  base("should be on a redirect and on the answer to a refused write", async ({ request }) => {
    const redirect = await request.get("/", { maxRedirects: 0 });
    expect(redirect.status()).toBe(307);
    expect(redirect.headers()["x-content-type-options"]).toBe("nosniff");

    const refused = await request.post("/_serverFn/anything", { headers: { "sec-fetch-site": "cross-site" } });
    expect(refused.status()).toBe(403);
    expect(refused.headers()["x-content-type-options"]).toBe("nosniff");
    expect(refused.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
  });

  base("should allow Google Fonts and nothing else outside the app", async ({ request }) => {
    const csp = (await request.get("/sign-in")).headers()["content-security-policy"];

    expect(csp).toContain("https://fonts.googleapis.com");
    expect(csp).toContain("https://fonts.gstatic.com");
    expect(csp).not.toMatch(/\*/);
  });

  base("should give the page's scripts a nonce and no way to run other inline scripts", async ({ request }) => {
    const response = await request.get("/sign-in");
    const csp = response.headers()["content-security-policy"];
    const nonce = nonceOf(csp);
    expect(nonce).toBeTruthy();

    const scriptSrc = csp.split("; ").find((directive) => directive.startsWith("script-src"))!;
    expect(scriptSrc).not.toContain("unsafe-inline");
    expect(scriptSrc).not.toContain("unsafe-eval");

    // Every inline script the router wrote carries this response's nonce, and the browser side can read it from the meta tag.
    const html = await response.text();
    const inlineScripts = [...html.matchAll(/<script(?![^>]*\ssrc=)([^>]*)>/g)];
    expect(inlineScripts.length).toBeGreaterThan(0);
    // The router writes the attribute with either kind of quote.
    for (const [, attributes] of inlineScripts) {
      expect([`nonce="${nonce}"`, `nonce='${nonce}'`].some((attribute) => attributes.includes(attribute))).toBe(true);
    }
    expect(html).toContain(`<meta property="csp-nonce" content="${nonce}"/>`);
  });

  base("should use a new nonce for every response", async ({ request }) => {
    const nonces = new Set<string | undefined>();
    for (let i = 0; i < 5; i++)
      nonces.add(nonceOf((await request.get("/sign-in")).headers()["content-security-policy"]));
    expect(nonces.size).toBe(5);
  });

  base("should stop an inline script that was injected into the page", async ({ page }) => {
    await gotoApp(page, "/sign-in");
    const violations = await page.evaluate(
      () =>
        new Promise<string[]>((resolve) => {
          const seen: string[] = [];
          document.addEventListener("securitypolicyviolation", (event) => seen.push(event.violatedDirective));
          const script = document.createElement("script");
          script.textContent = "window.injected = true";
          document.head.appendChild(script);
          setTimeout(() => resolve(seen), 200);
        }),
    );

    expect(violations).toContain("script-src-elem");
    expect(await page.evaluate(() => "injected" in window)).toBe(false);
  });
});

// The CSP is only worth having if the app itself does not break it. Every page is opened with the console watched,
// because a blocked script or style shows up there as a violation.
const signedInPages = [
  "/home",
  "/current-workout",
  "/start-workout",
  "/workout-library",
  "/workout-library/new",
  "/workout-history",
  "/movements",
  "/body-weight",
  "/account",
];

async function watchForViolations(page: Page) {
  const violations: string[] = [];
  page.on("console", (message) => {
    if (/content security policy/i.test(message.text())) violations.push(message.text());
  });
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      console.log(`Content Security Policy violation: ${event.violatedDirective} ${event.blockedURI}`);
    });
  });
  return violations;
}

base("should cause no CSP violations on the sign-in and sign-up pages", async ({ page }) => {
  const violations = await watchForViolations(page);
  for (const path of ["/sign-in", "/create-account"]) {
    await gotoApp(page, path);
    await page.waitForLoadState("networkidle");
  }
  expect(violations).toEqual([]);
});

test("should cause no CSP violations on any signed-in page", async ({ page }) => {
  const violations = await watchForViolations(page);
  for (const path of signedInPages) {
    await gotoApp(page, path);
    await page.waitForLoadState("networkidle");
  }
  expect(violations).toEqual([]);
});
