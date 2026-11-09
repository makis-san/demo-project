import { test, expect, newTestUser, signUp } from "./fixtures";
import { getDb, seedCompletedWorkouts } from "./db";
import {
  addSet,
  completeWorkout,
  goTo,
  logBodyWeight,
  selectMovement,
  setRows,
  setTexts,
  startWorkout,
} from "./helpers";

const toast = (page: import("@playwright/test").Page) => page.locator(".Toastify__toast");
const chartTitles = (page: import("@playwright/test").Page) =>
  page
    .getByRole("img", { name: /over time$/ })
    .locator("circle title")
    .allTextContents();

test.describe("Editing a set", () => {
  test.beforeEach(async ({ page }) => {
    await startWorkout(page);
    await addSet(page, { movement: "Bench Press", weight: 80, reps: 5 });
    await addSet(page, { movement: "Bench Press", weight: 90, reps: 5 });
  });

  test("should change the weight and reps in place and keep the set's place in the list", async ({ page }) => {
    await page.getByRole("button", { name: "Edit Bench Press set: 5 × 80 lbs" }).click();
    await page.getByRole("spinbutton", { name: "Weight for Bench Press" }).fill("85");
    await page.getByRole("spinbutton", { name: "Reps for Bench Press" }).fill("6");
    await page.getByRole("button", { name: "Save set" }).click();

    await expect(setRows(page).first()).toContainText("6 reps × 85 lbs");
    await expect(setRows(page).nth(1)).toContainText("5 reps × 90 lbs");
    expect(await setTexts(page)).toHaveLength(2);
    await expect(toast(page)).toHaveCount(0);
    // It was saved, in the same place: a reload shows the same.
    await page.reload();
    await expect(setRows(page).first()).toContainText("6 reps × 85 lbs");
    await expect(setRows(page).nth(1)).toContainText("5 reps × 90 lbs");
  });

  test("should leave the set as it was when the edit is cancelled", async ({ page }) => {
    await page.getByRole("button", { name: "Edit Bench Press set: 5 × 80 lbs" }).click();
    await page.getByRole("spinbutton", { name: "Weight for Bench Press" }).fill("999");
    await page.getByRole("button", { name: "Cancel edit" }).click();

    await expect(setRows(page).first()).toContainText("5 reps × 80 lbs");
  });

  test("should refuse bad values with the messages adding a set gives", async ({ page }) => {
    await page.getByRole("button", { name: "Edit Bench Press set: 5 × 80 lbs" }).click();
    const save = page.getByRole("button", { name: "Save set" });

    await page.getByRole("spinbutton", { name: "Reps for Bench Press" }).fill("0");
    await expect(save).toBeDisabled();
    await expect(page.getByText("Reps: ")).toBeVisible();
    await page.getByRole("spinbutton", { name: "Reps for Bench Press" }).fill("5");

    await page.getByRole("spinbutton", { name: "Weight for Bench Press" }).fill("80.123");
    await expect(save).toBeDisabled();
    await expect(page.getByText("Weight: Use at most 2 decimal places")).toBeVisible();
    await page.getByRole("spinbutton", { name: "Weight for Bench Press" }).fill("10000");
    await expect(save).toBeDisabled();
    await page.getByRole("spinbutton", { name: "Weight for Bench Press" }).fill("");
    await expect(save).toBeDisabled();

    await page.getByRole("spinbutton", { name: "Weight for Bench Press" }).fill("82.5");
    await expect(save).toBeEnabled();
  });

  test("should refuse bad values on the server too", async ({ page }) => {
    await page.getByRole("button", { name: "Edit Bench Press set: 5 × 80 lbs" }).click();
    await page.getByRole("spinbutton", { name: "Weight for Bench Press" }).fill("85");
    // The form would not send this, so change the request the way an edited one would.
    await page.route("**/_serverFn/**", async (route) => {
      const body = route.request().postData();
      if (route.request().method() === "POST" && body?.includes("85")) {
        await route.continue({ postData: body.replace(/85/, "-5") });
      } else await route.continue();
    });
    await page.getByRole("button", { name: "Save set" }).click();

    await expect(toast(page)).toContainText("Invalid input");
    await page.unroute("**/_serverFn/**");
    await page.reload();
    await expect(setRows(page).first()).toContainText("5 reps × 80 lbs");
  });

  test("should not edit another user's set", async ({ page, browser, user }) => {
    const other = newTestUser();
    const otherContext = await browser.newContext();
    await signUp(await otherContext.newPage(), other);
    await seedCompletedWorkouts(other.email, [
      { completedAt: new Date(), sets: [{ movement: "Bench Press", weight: 300, reps: 1 }] },
    ]);
    await otherContext.close();
    const foreign = await getDb().set.findFirstOrThrow({ where: { workout: { user: { email: other.email } } } });
    const own = await getDb().set.findFirstOrThrow({ where: { weight: 80, workout: { user: { email: user.email } } } });

    await page.getByRole("button", { name: "Edit Bench Press set: 5 × 80 lbs" }).click();
    await page.getByRole("spinbutton", { name: "Weight for Bench Press" }).fill("85");
    await page.route("**/_serverFn/**", async (route) => {
      const body = route.request().postData();
      if (route.request().method() === "POST" && body?.includes(own.id)) {
        await route.continue({ postData: body.replaceAll(own.id, foreign.id) });
      } else await route.continue();
    });
    await page.getByRole("button", { name: "Save set" }).click();

    await expect(toast(page)).toContainText("Set not found");
    const after = await getDb().set.findUniqueOrThrow({ where: { id: foreign.id } });
    expect(after.weight.toNumber()).toBe(300);
    expect(after.reps).toBe(1);
  });
});

test.describe("Editing a completed workout", () => {
  test("should fix a set in history and show the new value in the table and the chart", async ({ page }) => {
    await completeWorkout(page, [
      { movement: "Bench Press", weight: 100, reps: 5 },
      { movement: "Bench Press", weight: 95, reps: 5 },
    ]);
    await goTo(page, "Workout History");
    const row = page.getByRole("row").filter({ has: page.getByRole("checkbox", { name: "Select workout" }) });
    await page.getByLabel("Movement", { exact: true }).selectOption({ label: "Bench Press" });
    await page.getByLabel("Metric").selectOption({ label: "Max weight" });
    await expect(row).toContainText("100 lbs / 5 reps / 2 sets");
    expect(await chartTitles(page)).toEqual([expect.stringMatching(/^100 lbs on /)]);

    await row.getByRole("button", { name: "Show the sets of this workout" }).click();
    await page.getByRole("button", { name: "Edit Bench Press set: 5 × 100 lbs" }).click();
    await page.getByRole("spinbutton", { name: "Weight for Bench Press" }).fill("102.5");
    await page.getByRole("button", { name: "Save set" }).click();

    await expect(row).toContainText("102.5 lbs / 5 reps / 2 sets");
    await expect.poll(() => chartTitles(page)).toEqual([expect.stringMatching(/^102\.5 lbs on /)]);
    // And on the muscles card, which reads the same sets: nothing to change in a weight, so it still counts 2.
    await expect(
      page.getByRole("list", { name: "Sets per muscle group" }).locator("[data-muscle='chest']"),
    ).toContainText("2");
  });
});

test.describe("Editing body weight", () => {
  test.use({ timezoneId: "America/Recife" });
  const entries = (page: import("@playwright/test").Page) =>
    page.getByRole("list", { name: "Body weight entries" }).getByRole("listitem");
  const chart = (page: import("@playwright/test").Page) => page.getByRole("img", { name: "Body weight over time" });
  const localDay = (daysAgo: number) =>
    new Date(Date.now() - daysAgo * 86400000).toLocaleDateString("en-CA", { timeZone: "America/Recife" });

  test("should change an entry's weight and date, and show it in the list, the chart and the stats", async ({
    page,
  }) => {
    await logBodyWeight(page, 181);
    await logBodyWeight(page, 180.2);

    await entries(page).first().getByRole("button", { name: "Edit entry" }).click();
    await page.getByLabel("Edit weight").fill("179.4");
    await page.getByRole("button", { name: "Save entry" }).click();

    await expect(entries(page).first()).toContainText("179.4 lbs");
    await expect(chart(page).locator("circle title").last()).toContainText("179.4 lbs on");
    await expect(page.getByText("Latest", { exact: true }).locator("..")).toContainText("179.4");

    // Move the other entry's date back, and it becomes the older one.
    await entries(page).first().getByRole("button", { name: "Edit entry" }).click();
    await page.getByLabel("Edit date").fill(localDay(3));
    await page.getByRole("button", { name: "Save entry" }).click();
    await expect(entries(page).first()).toContainText("181 lbs");
    await expect(entries(page).last()).toContainText("179.4 lbs");
    await page.reload();
    await expect(entries(page).last()).toContainText("179.4 lbs");
  });

  test("should start a body-weight movement from the edited weight", async ({ page }) => {
    await logBodyWeight(page, 182);
    await entries(page).first().getByRole("button", { name: "Edit entry" }).click();
    await page.getByLabel("Edit weight").fill("181.5");
    await page.getByRole("button", { name: "Save entry" }).click();
    await expect(entries(page).first()).toContainText("181.5 lbs");

    await startWorkout(page);
    await selectMovement(page, "Pull-Up");
    await expect(page.getByLabel("Weight", { exact: true })).toHaveValue("181.5");
  });

  test("should refuse a bad weight or a date in the future", async ({ page }) => {
    await logBodyWeight(page, 180);
    await entries(page).first().getByRole("button", { name: "Edit entry" }).click();
    const save = page.getByRole("button", { name: "Save entry" });

    await page.getByLabel("Edit weight").fill("0");
    await expect(save).toBeDisabled();
    await expect(page.getByText("Weight: Must be more than 0")).toBeVisible();
    await page.getByLabel("Edit weight").fill("180.555");
    await expect(save).toBeDisabled();
    await page.getByLabel("Edit weight").fill("180");

    await page.getByLabel("Edit date").fill("2099-01-01");
    await expect(save).toBeDisabled();
    await expect(page.getByText("The date can't be in the future")).toBeVisible();
  });

  test("should not edit another user's entry", async ({ page, browser, user }) => {
    const other = newTestUser();
    const otherContext = await browser.newContext();
    await signUp(await otherContext.newPage(), other);
    const otherUser = await getDb().user.findUniqueOrThrow({ where: { email: other.email } });
    const foreign = await getDb().bodyWeight.create({ data: { userId: otherUser.id, weight: 200 } });
    await otherContext.close();

    await logBodyWeight(page, 180);
    const own = await getDb().bodyWeight.findFirstOrThrow({ where: { user: { email: user.email } } });
    await entries(page).first().getByRole("button", { name: "Edit entry" }).click();
    await page.getByLabel("Edit weight").fill("170");
    await page.route("**/_serverFn/**", async (route) => {
      const body = route.request().postData();
      if (route.request().method() === "POST" && body?.includes(own.id)) {
        await route.continue({ postData: body.replaceAll(own.id, foreign.id) });
      } else await route.continue();
    });
    await page.getByRole("button", { name: "Save entry" }).click();

    await expect(toast(page)).toContainText("Entry not found");
    const after = await getDb().bodyWeight.findUniqueOrThrow({ where: { id: foreign.id } });
    expect(after.weight.toNumber()).toBe(200);
  });
});
