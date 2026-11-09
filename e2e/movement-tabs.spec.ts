import { test, expect } from "./fixtures";
import { addMovement, goTo, movementRow, startWorkout } from "./helpers";

const names = (page: import("@playwright/test").Page) =>
  page.getByRole("list", { name: "Movements" }).getByRole("link").allTextContents();

test.describe("Movement tabs", () => {
  test("should have a tab for each body part, with the number of movements in it", async ({ page }) => {
    await goTo(page, "Movements");

    const tabs = page.getByRole("tablist", { name: "Body part" }).getByRole("tab");
    await expect(tabs).toHaveText([
      /^All\s*98$/,
      /^Chest/,
      /^Back/,
      /^Shoulders/,
      /^Biceps/,
      /^Triceps/,
      /^Forearms/,
      /^Legs/,
      /^Core/,
    ]);
    await expect(page.getByRole("tab", { name: /^All/ })).toHaveAttribute("aria-selected", "true");
  });

  test("should filter the library by body part, and show a movement under each body part it works", async ({
    page,
  }) => {
    await goTo(page, "Movements");

    await page.getByRole("tab", { name: /^Chest/ }).click();
    await expect(page.getByRole("tab", { name: /^Chest/ })).toHaveAttribute("aria-selected", "true");
    expect(await names(page)).toEqual(expect.arrayContaining(["Bench Press", "Push-Up", "Dip"]));
    expect(await names(page)).not.toContain("Back Squat");

    await page.getByRole("tab", { name: /^Biceps/ }).click();
    expect(await names(page)).toEqual(expect.arrayContaining(["Barbell Curl", "Chin-Up"]));
    expect(await names(page)).not.toContain("Bench Press");

    // The deadlift is worked by the back and the legs, so it is under both.
    await page.getByRole("tab", { name: /^Back/ }).click();
    expect(await names(page)).toContain("Deadlift");
    await page.getByRole("tab", { name: /^Legs/ }).click();
    expect(await names(page)).toContain("Deadlift");

    await page.getByRole("tab", { name: /^All/ }).click();
    expect((await names(page)).length).toBeGreaterThanOrEqual(90);
  });

  test("should combine a tab with search and with the other filters", async ({ page }) => {
    await goTo(page, "Movements");
    await page.getByRole("tab", { name: /^Legs/ }).click();
    await page.getByLabel("Search movements").fill("curl");

    expect(await names(page)).toEqual(["Lying Leg Curl", "Nordic Curl", "Seated Leg Curl"]);
    await page.getByLabel("Filter by equipment").selectOption({ label: "Machine" });
    expect((await names(page)).length).toBe(2);
    await page.getByRole("button", { name: /^Body wt/ }).click();
    await expect(page.getByText("No movements match.")).toBeVisible();
  });

  test("should count a custom movement in the tab of its muscles, and not in any tab when it has none", async ({
    page,
  }) => {
    await goTo(page, "Movements");
    await page.getByLabel("Movement name").fill("Cable Y-Raise");
    await page.getByRole("button", { name: "Shoulders: not used" }).click();
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(movementRow(page, "Cable Y-Raise")).toBeVisible();
    await addMovement(page, "Mystery Lift");

    await page.getByRole("tab", { name: /^Shoulders/ }).click();
    expect(await names(page)).toContain("Cable Y-Raise");
    expect(await names(page)).not.toContain("Mystery Lift");
    await page.getByRole("tab", { name: /^All/ }).click();
    expect(await names(page)).toContain("Mystery Lift");
  });

  test("should filter the movement sheet in the workout by body part too", async ({ page }) => {
    await startWorkout(page);
    await page.getByRole("button", { name: "Add movement", exact: true }).click();
    const sheet = page.getByRole("dialog", { name: "Choose a movement" });
    await sheet.getByRole("tab", { name: /^Biceps/ }).click();

    await expect(sheet.getByRole("button", { name: "Barbell Curl", exact: true })).toBeVisible();
    await expect(sheet.getByRole("button", { name: "Bench Press", exact: true })).toHaveCount(0);
    // Searching inside the tab.
    await sheet.getByRole("searchbox", { name: "Search movements" }).fill("hammer");
    await expect(sheet.getByRole("list", { name: "Movements" }).getByRole("listitem")).toHaveCount(1);
    await sheet.getByRole("button", { name: "Hammer Curl", exact: true }).click();
    await expect(page.getByRole("group", { name: "Selected movement" })).toContainText("Hammer Curl");
  });

  test("should load the movement sheet a page at a time inside a tab", async ({ page }) => {
    await startWorkout(page);
    await page.getByRole("button", { name: "Add movement", exact: true }).click();
    const sheet = page.getByRole("dialog", { name: "Choose a movement" });
    await sheet.getByRole("tab", { name: /^Legs/ }).click();

    const cards = sheet.getByRole("list", { name: "Movements" }).getByRole("listitem");
    await expect(cards).toHaveCount(20);
    const list = sheet.getByRole("list", { name: "Movements" }).locator("xpath=..");
    await expect
      .poll(
        async () => {
          await list.evaluate((el) => el.scrollTo(0, el.scrollHeight));
          return cards.count();
        },
        { timeout: 15_000 },
      )
      .toBe(30);
  });
});

test.describe("Movement cards", () => {
  test("should show an image of the body part at the start of every card", async ({ page }) => {
    await goTo(page, "Movements");

    const card = movementRow(page, "Bench Press");
    const image = card.locator("svg.body-thumb");
    await expect(image).toBeVisible();
    // The image is lit where the movement works: the chest is hot, the quads are not.
    await expect(image.locator("[data-muscle='chest']")).toHaveAttribute("data-level", "1");
    await expect(image.locator("[data-muscle='shoulders']")).toHaveAttribute("data-level", "0.5");
    await expect(image.locator("[data-muscle='quads']")).toHaveAttribute("data-level", "0");
    // A back movement shows the back of the body.
    await expect(movementRow(page, "Barbell Row").locator("svg.body-thumb")).toHaveAttribute("data-side", "back");
    await expect(card.locator("svg.body-thumb")).toHaveAttribute("data-side", "front");
  });

  test("should select cards with their checkmark, and say how many are selected", async ({ page }) => {
    await goTo(page, "Movements");
    const bench = page.getByRole("checkbox", { name: "Select Bench Press", exact: true });
    await expect(bench).toHaveAttribute("aria-checked", "false");
    await expect(page.getByRole("region", { name: "Selected movements" })).toHaveCount(0);

    await bench.click();
    await page.getByRole("checkbox", { name: "Select Back Squat", exact: true }).click();
    await expect(bench).toHaveAttribute("aria-checked", "true");
    await expect(page.getByRole("region", { name: "Selected movements" })).toContainText("2 selected");
    await expect(movementRow(page, "Bench Press").locator("[data-selected]")).toHaveAttribute("data-selected", "true");
    // Selecting does not open the movement.
    await expect(page).toHaveURL(/\/movements$/);

    await page.getByRole("checkbox", { name: "Select Back Squat", exact: true }).click();
    await expect(page.getByRole("region", { name: "Selected movements" })).toContainText("1 selected");
    await page.getByRole("button", { name: "Clear" }).click();
    await expect(page.getByRole("region", { name: "Selected movements" })).toHaveCount(0);
  });

  test("should keep the selection while the tab changes, and build a workout from it", async ({ page }) => {
    await goTo(page, "Movements");
    await page.getByRole("tab", { name: /^Chest/ }).click();
    await page.getByRole("checkbox", { name: "Select Bench Press", exact: true }).click();
    await page.getByRole("tab", { name: /^Back/ }).click();
    await page.getByRole("checkbox", { name: "Select Barbell Row", exact: true }).click();
    await expect(page.getByRole("region", { name: "Selected movements" })).toContainText("2 selected");

    await page.getByRole("link", { name: "Create workout" }).click();

    await expect(page).toHaveURL(/\/workout-library\/new/);
    // In the order they were ticked, each with its default series and rest, none lost.
    await expect(page.locator("[data-exercise]")).toHaveText([/Bench Press/, /Barbell Row/]);
    await page.getByRole("button", { name: "Next: Sets & rest" }).click();
    await expect(page.getByLabel("Reps of every set of Barbell Row")).toHaveValue("10");
    await expect(page.getByRole("button", { name: "Rest after each set of Barbell Row", exact: true })).toHaveText(
      "1 min",
    );
  });

  test("should open the movement from the card", async ({ page }) => {
    await goTo(page, "Movements");
    await movementRow(page, "Bench Press").getByRole("link").click();

    await expect(page.getByRole("heading", { level: 1, name: "Bench Press" })).toBeVisible();
  });
});
