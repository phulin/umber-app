import { expect, test } from "@playwright/test";

test("renders the app shell", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Local LaTeX workspace" })).toBeVisible();
  await expect(page.getByRole("button", { name: "New Project" })).toBeVisible();
  await expect(page.getByText("HTML Preview")).toBeVisible();
  await expect(page.getByText("Hello, Umber.")).toBeVisible();
});
