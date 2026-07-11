import { expect, test } from "@playwright/test";

test("renders the app shell", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("button", { name: "Umber Browser-native TeX" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy into a project" })).toBeVisible();
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

test("copies the demo into OPFS and persists edits across reload", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Copy into a project" }).click();
  await expect(page).toHaveURL(/#\/project\//);
  const editor = page.locator('[role="textbox"]:visible');
  await editor.focus();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("% persisted note");
  await page.waitForTimeout(650);

  await page.reload();
  await expect(page.locator('[role="textbox"]:visible')).toContainText("% persisted note");
  await page.getByRole("button", { name: "Projects" }).click();
  await expect(page.getByRole("button", { name: /Umber demo/ })).toBeVisible();
});
