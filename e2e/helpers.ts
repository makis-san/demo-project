import { expect, type Page } from "@playwright/test";

type Section =
  | "Home"
  | "Current Workout"
  | "Workout Library"
  | "Workout History"
  | "Movements"
  | "Body Weight"
  | "Account";

/** Opens a page from the sidebar, the way a user would. */
export async function goTo(page: Page, section: Section) {
  await page.getByRole("link", { name: section, exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: section })).toBeVisible();
}

/**
 * Creates a custom movement through the form. The library already has about a hundred built-ins (Bench Press, Back
 * Squat, Pull-Up...), and a custom movement cannot take one of their names, so use a name that is not in it.
 */
export async function addMovement(page: Page, name: string, options: { bodyWeight?: boolean } = {}) {
  await goTo(page, "Movements");
  await page.getByLabel("Movement name").fill(name);
  if (options.bodyWeight) await page.getByRole("checkbox", { name: /Body-weight movement/ }).check();
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(movementRow(page, name)).toBeVisible();
}

/** The row of a movement in the library, found by its exact name. */
export function movementRow(page: Page, name: string) {
  return page.getByRole("listitem").filter({ has: page.getByRole("link", { name, exact: true }) });
}

/**
 * Adds an extra movement to the workout in progress the way a user does: tap "Add movement", search the sheet that opens,
 * tap the movement. The set form then shows for it.
 */
export async function selectMovement(page: Page, name: string) {
  await page.getByRole("button", { name: "Add movement", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Choose a movement" });
  await sheet.getByRole("searchbox", { name: "Search movements" }).fill(name);
  await sheet.getByRole("button", { name, exact: true }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Selected movement" })).toContainText(name);
}

/**
 * Presses Start on the Start screen. A countdown of 3, 2, 1, GO runs first and the workout is created after it, so this
 * waits for the Current Workout page. With `wait: false` it only presses, for a test that expects Start to be refused.
 */
export async function pressStart(page: Page, { wait = true }: { wait?: boolean } = {}) {
  await page.getByRole("button", { name: "Start workout" }).click();
  if (wait) await expect(page).toHaveURL(/\/current-workout/, { timeout: 15_000 });
}

export async function logBodyWeight(page: Page, weight: number) {
  await goTo(page, "Body Weight");
  const entries = page.getByRole("list", { name: "Body weight entries" }).getByRole("listitem");
  const before = await entries.count();
  await page.getByLabel("Weight in lbs").fill(String(weight));
  await page.getByRole("button", { name: "Log weight" }).click();
  await expect(entries).toHaveCount(before + 1);
}

/** Starts an empty workout the way a user does: open it, look at it, and press Start. Nothing begins before that. */
export async function startWorkout(page: Page) {
  await goTo(page, "Current Workout");
  await page.getByRole("link", { name: "Empty workout" }).click();
  await pressStart(page);
  await expect(page.getByRole("button", { name: "Finish Workout" })).toBeVisible();
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
  await selectMovement(page, set.movement);
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
  await page.getByRole("button", { name: "Finish Workout" }).click();
  await expect(page.getByText("No active workout. Ready to start?")).toBeVisible();
}

/** Ticks movements in the "Add movements" chooser and adds them, the way a user picks several at once. */
export async function pickMovements(page: Page, names: string[]) {
  await page.getByRole("button", { name: "Add movements" }).click();
  const dialog = page.getByRole("dialog", { name: "Add movements" });
  for (const name of names) {
    await dialog.getByRole("searchbox", { name: "Search movements" }).fill(name);
    await dialog.getByRole("checkbox", { name: `Select ${name}`, exact: true }).click();
  }
  await dialog.getByRole("button", { name: /^Add \d+ movements?$/ }).click();
  await expect(dialog).toHaveCount(0);
}

/** Builds and saves a workout in the library through the form: a name, movements, and optionally the weekdays. */
export async function createWorkout(page: Page, name: string, movements: string[], weekdays: string[] = []) {
  await goTo(page, "Workout Library");
  await page
    .getByRole("link", { name: /^(New workout|Create your first workout)$/ })
    .first()
    .click();
  await expect(page.getByRole("button", { name: "Save workout" })).toBeVisible();
  await page.getByLabel("Workout name").fill(name);
  await pickMovements(page, movements);
  for (const day of weekdays) await page.getByRole("button", { name: day, exact: true }).click();
  await page.getByRole("button", { name: "Save workout" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Workout Library" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Your workouts" }).getByText(name, { exact: true })).toBeVisible();
}

/** The weekday names of the user's today and the days after it, in a timezone: ["Sunday", "Monday", ...]. */
export function weekdayNamesFrom(timeZone: string, count = 3) {
  return Array.from({ length: count }, (_, i) =>
    new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone }).format(new Date(Date.now() + i * 86_400_000)),
  );
}
