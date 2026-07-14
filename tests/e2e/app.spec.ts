import { expect, test } from "@playwright/test";
import { strToU8, zipSync } from "fflate";

test("renders the app shell", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("button", { name: "Umber Browser-native TeX" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy into a project" })).toBeVisible();
  await expect(page.getByText("HTML Preview")).toBeVisible();
  const preview = page.frameLocator("iframe.standalone-preview");
  await expect(preview.locator(".umber-page")).toBeVisible();
  await expect(preview.locator("body")).toContainText("A tiny book about umber");
  const pageWidth = await preview
    .locator(".umber-page")
    .evaluate((element) => element.getBoundingClientRect().width);
  const previewWidth = await page
    .locator("iframe.standalone-preview")
    .evaluate((element) => element.clientWidth);
  expect(pageWidth).toBeLessThanOrEqual(previewWidth);
  const diagnostics = page.locator("details.diagnostics-panel");
  await expect(diagnostics).toHaveAttribute("open", "");
  await diagnostics.locator("summary").click();
  await expect(diagnostics).not.toHaveAttribute("open", "");

  const editor = page.getByRole("textbox").first();
  await editor.focus();
  await page.keyboard.press("Control+A");
  await page.keyboard.type("Updated in the browser.\\par\\bye");
  await expect(preview.locator("body")).toContainText("Updated in the browser.");
  await expect(page.getByText(/Edit → patch p50/).locator("..")).not.toContainText("— ms");
});

test("shows one editor without file navigation", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".file-tree")).toHaveCount(0);
  await expect(page.getByRole("tablist", { name: "Open files" })).toHaveCount(0);
  await expect(page.locator('[role="textbox"]:visible')).toHaveCount(1);
});

test("recovers from transient TeX errors during rapid editing", async ({ page }) => {
  await page.goto("/");
  const editor = page.locator('[role="textbox"]:visible');
  const preview = page.frameLocator("iframe.standalone-preview");

  await editor.focus();
  await page.keyboard.press("Control+A");
  await page.keyboard.type("}");
  await page.keyboard.press("Control+A");
  await page.keyboard.type("Recovered quickly.\\par\\bye");

  await expect(preview.locator("body")).toContainText("Recovered quickly.");
  await expect(page.getByText(/Engine recovery started automatically/)).toHaveCount(0);
});

test("renders Plain TeX math with scripts, symbols, and extensions", async ({ page }) => {
  await page.goto("/");
  const editor = page.locator('[role="textbox"]:visible');
  const preview = page.frameLocator("iframe.standalone-preview");

  await editor.focus();
  await page.keyboard.press("Control+A");
  await page.keyboard.insertText(
    String.raw`A useful identity: $x^2+y^2=z^2$ and $\alpha\leq\beta$.\par
$$\sum_{x}^{y} f(x).$$\bye`,
  );

  await expect(preview.locator("body")).toContainText("A useful identity");
  const sumGlyph = String.fromCodePoint(0xe000 + 88);
  const sum = preview.locator(".umber-run-text").filter({ hasText: sumGlyph });
  await expect(sum).toBeVisible();
  await expect(preview.locator(".umber-run-text").filter({ hasText: "≤" })).toBeVisible();
  const runViewport = await sum.evaluate((element) => {
    const run = element.closest(".umber-run");
    return run ? { width: run.clientWidth, height: run.clientHeight } : null;
  });
  expect(runViewport?.width).toBeGreaterThan(0);
  expect(runViewport?.height).toBeGreaterThan(0);
  const [sumBox, upperLimitBox] = await Promise.all([
    sum.boundingBox(),
    preview.locator(".umber-run-text").filter({ hasText: "y" }).first().boundingBox(),
  ]);
  expect((upperLimitBox?.y ?? 0) + (upperLimitBox?.height ?? 0)).toBeLessThanOrEqual(
    (sumBox?.y ?? 0) + 1,
  );
  await expect(page.getByText("No diagnostics.")).toBeVisible();
});

test("persists demo scratch edits and copies their current state into a project", async ({
  page,
}) => {
  await page.goto("/");
  let editor = page.locator('[role="textbox"]:visible');
  await editor.focus();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("% scratch note");
  await page.waitForTimeout(650);

  await page.reload();
  editor = page.locator('[role="textbox"]:visible');
  await expect(editor).toContainText("% scratch note");
  await page.getByRole("button", { name: "Copy into a project" }).click();
  await expect(page).toHaveURL(/#\/project\//);
  editor = page.locator('[role="textbox"]:visible');
  await expect(editor).toContainText("% scratch note");
  await editor.focus();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("% persisted note");
  await page.waitForTimeout(650);

  await page.reload();
  await expect(page.locator('[role="textbox"]:visible')).toContainText("% persisted note");
  await page.getByRole("button", { name: "Projects" }).click();
  await expect(page.getByRole("button", { name: /Umber demo/ })).toBeVisible();
});

test("imports binary project resources without opening them as text", async ({ page }) => {
  await page.goto("/#/projects");
  const archive = zipSync({
    ".umber/manifest.json": strToU8(JSON.stringify({ name: "Binary paper", entry: "main.tex" })),
    "main.tex": strToU8("\\documentclass{article}"),
    "figures/plot.png": new Uint8Array([137, 80, 78, 71]),
  });

  await page.locator('input[accept*="zip"]').setInputFiles({
    name: "paper.zip",
    mimeType: "application/zip",
    buffer: Buffer.from(archive),
  });

  await expect(page).toHaveURL(/#\/project\//);
  await expect(page.locator(".file-tree")).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "figures/plot.png" })).toHaveCount(0);
});
