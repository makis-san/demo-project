import { chromium, type FullConfig } from "@playwright/test";
import { newTestUser, signUp } from "./fixtures";

/**
 * The dev server compiles pages the first time they are opened, and its first
 * few requests can fail while it re-optimizes dependencies. Opening every page
 * once before the tests keeps that out of the first tests.
 */
export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0].use.baseURL!;

  for (let attempt = 0; attempt < 60; attempt++) {
    const response = await fetch(`${baseURL}/api/health`).catch(() => null);
    if (response?.ok) break;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  const browser = await chromium.launch();
  const page = await browser.newPage({ baseURL });
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await signUp(page, newTestUser());
      for (const path of [
        "/home",
        "/movements",
        "/workout-history",
        "/body-weight",
        "/current-workout",
        "/workout-library",
      ]) {
        await page.goto(path, { waitUntil: "networkidle" });
      }
      break;
    } catch (error) {
      if (attempt === 2) throw error;
      await page.context().clearCookies();
    }
  }
  await browser.close();
}
