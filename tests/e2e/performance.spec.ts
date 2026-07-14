import { expect, test } from "@playwright/test";

test("cold demo reaches its first rendered page within the launch budget", async ({ page }) => {
  const startedAt = Date.now();
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.frameLocator("iframe.standalone-preview").locator(".umber-page")).toBeVisible();
  const elapsedMs = Date.now() - startedAt;

  expect(elapsedMs).toBeLessThanOrEqual(3_000);
});
