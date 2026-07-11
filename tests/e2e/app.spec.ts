import { expect, test } from "@playwright/test";

test("renders the app shell", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Local LaTeX workspace" })).toBeVisible();
  await expect(page.getByRole("button", { name: "New Project" })).toBeVisible();
  await expect(page.getByText("HTML Preview")).toBeVisible();
  const previewSpan = page.locator("#span-1");
  await expect(previewSpan).toHaveText("Hello, Umber.");
  await expect(page.getByText("Fake engine source-span check")).toBeVisible();

  await previewSpan.click();
  await expect(page.getByRole("textbox").first()).toBeFocused();
  await expect(previewSpan).toHaveClass(/source-sync-highlight/);
});

test("preserves independent editor documents while switching tabs", async ({ page }) => {
  await page.goto("/");
  const visibleEditor = () => page.locator('[role="textbox"]:visible');

  await visibleEditor().focus();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("% main note");
  await page.getByRole("tab", { name: "references.bib" }).click();
  await expect(visibleEditor()).toContainText("Browser-Native TeX");
  await visibleEditor().focus();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("% bib note");

  await page.getByRole("tab", { name: "main.tex" }).click();
  await expect(visibleEditor()).toContainText("% main note");
  await page.getByRole("tab", { name: "references.bib" }).click();
  await expect(visibleEditor()).toContainText("% bib note");
});
