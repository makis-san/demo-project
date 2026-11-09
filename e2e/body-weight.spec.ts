import { test, expect } from "./fixtures";
import { goTo, logBodyWeight, selectMovement, setRows, startWorkout } from "./helpers";

test.describe("Body weight", () => {
  test("should log a body weight and show it in the list and the chart", async ({ page }) => {
    await goTo(page, "Body Weight");
    await expect(page.getByText("No body weight logged yet")).toBeVisible();
    await expect(page.getByRole("button", { name: "Log weight" })).toBeDisabled();

    await logBodyWeight(page, 180.5);

    const entries = page.getByRole("list", { name: "Body weight entries" }).getByRole("listitem");
    await expect(entries).toHaveCount(1);
    await expect(entries).toContainText("180.5 lbs");
    // One point on the chart, and hovering it names the value.
    const chart = page.getByRole("img", { name: "Body weight over time" });
    await expect(chart.locator("circle")).toHaveCount(1);
    await expect(chart.locator("circle title")).toContainText("180.5 lbs on");
  });

  test("should plot every entry and let one be deleted", async ({ page }) => {
    await logBodyWeight(page, 181);
    await logBodyWeight(page, 180.2);
    await logBodyWeight(page, 179.6);
    const chart = page.getByRole("img", { name: "Body weight over time" });
    await expect(chart.locator("circle")).toHaveCount(3);

    // Newest first in the list.
    const entries = page.getByRole("list", { name: "Body weight entries" }).getByRole("listitem");
    await expect(entries.first()).toContainText("179.6 lbs");

    await entries.first().getByRole("button", { name: "Delete entry" }).click();
    await expect(entries).toHaveCount(2);
    await expect(chart.locator("circle")).toHaveCount(2);
  });

  test("should default the weight of a body-weight movement to the latest body weight", async ({ page }) => {
    await logBodyWeight(page, 182);
    await logBodyWeight(page, 181.4);

    await startWorkout(page);
    const weight = page.getByLabel("Weight");
    await selectMovement(page, "Pull-Up");
    // The most recent entry, not the first one.
    await expect(weight).toHaveValue("181.4");

    // It is only a starting value: the user can change it, for example for weighted pull-ups.
    await weight.fill("200");
    await page.getByLabel("Reps").fill("5");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(setRows(page).filter({ hasText: "Pull-Up" })).toContainText("5 reps × 200 lbs");

    // A filled-in body weight does not stay behind on a normal movement.
    await weight.fill("");
    await selectMovement(page, "Pull-Up");
    await expect(weight).toHaveValue("181.4");
    await selectMovement(page, "Bench Press");
    await expect(weight).toHaveValue("");
  });

  test("should leave the weight empty and say why when there is no body weight yet", async ({ page }) => {
    await startWorkout(page);

    await selectMovement(page, "Pull-Up");

    await expect(page.getByLabel("Weight")).toHaveValue("");
    await expect(page.getByText("No body weight recorded yet")).toBeVisible();
    await expect(page.getByRole("link", { name: "log your body weight" })).toBeVisible();
  });
});
