import { expect, type Page } from "@playwright/test";

type Section = "Current Workout" | "Workout History" | "Movements" | "Body Weight";

/** Opens a page from the sidebar, the way a user would. */
export async function goTo(page: Page, section: Section) {
  await page.getByRole("link", { name: section }).click();
  await expect(page.getByRole("heading", { level: 1, name: section })).toBeVisible();
}

export async function addMovement(page: Page, name: string, options: { bodyWeight?: boolean } = {}) {
  await goTo(page, "Movements");
  await page.getByLabel("Movement name").fill(name);
  if (options.bodyWeight) await page.getByRole("checkbox", { name: /Body-weight movement/ }).check();
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByRole("listitem").filter({ hasText: name })).toBeVisible();
}

export async function logBodyWeight(page: Page, weight: number) {
  await goTo(page, "Body Weight");
  const entries = page.getByRole("list", { name: "Body weight entries" }).getByRole("listitem");
  const before = await entries.count();
  await page.getByLabel("Weight in lbs").fill(String(weight));
  await page.getByRole("button", { name: "Log weight" }).click();
  await expect(entries).toHaveCount(before + 1);
}

export async function startWorkout(page: Page) {
  await goTo(page, "Current Workout");
  await page.getByRole("button", { name: "Start Workout" }).click();
  await expect(page.getByRole("button", { name: "Complete Workout" })).toBeVisible();
}

export function setRows(page: Page) {
  return page
    .getByRole("list")
    .filter({ has: page.getByRole("button", { name: /^Remove .* set$/ }) })
    .getByRole("listitem");
}

/** Adds a set from the form and waits until it shows in the list. */
export async function addSet(page: Page, set: { movement: string; weight: number; reps: number }) {
  const rows = setRows(page);
  const before = await rows.count();
  await page.getByLabel("Movement").selectOption({ label: set.movement });
  await page.getByLabel("Weight").fill(String(set.weight));
  await page.getByLabel("Reps").fill(String(set.reps));
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(rows).toHaveCount(before + 1);
}

/** The text of every set row, in the order shown, for example "Bench Press5 reps × 100 lbs". */
export async function setTexts(page: Page) {
  return setRows(page).allTextContents();
}

/** Starts a workout with the given sets and completes it. Ends on the current workout page. */
export async function completeWorkout(page: Page, sets: { movement: string; weight: number; reps: number }[]) {
  await startWorkout(page);
  for (const set of sets) await addSet(page, set);
  await page.getByRole("button", { name: "Complete Workout" }).click();
  await expect(page.getByText("No active workout. Ready to start?")).toBeVisible();
}
