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
  const pagePosition = await preview.locator(".umber-page").evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const root = element.querySelector<HTMLElement>('.umber-box[data-umber-event="0"]');
    const rootRect = root?.getBoundingClientRect();
    return {
      left: rect.left,
      top: rect.top,
      centeredLeft: (element.ownerDocument.documentElement.clientWidth - rect.width) / 2,
      scrollX: element.ownerDocument.defaultView?.scrollX,
      scrollY: element.ownerDocument.defaultView?.scrollY,
      margins: rootRect
        ? {
            left: rootRect.left - rect.left,
            right: rect.right - rootRect.right,
            top: rootRect.top - rect.top,
            bottom: rect.bottom - rootRect.bottom,
          }
        : undefined,
    };
  });
  expect(pagePosition.left).toBeCloseTo(pagePosition.centeredLeft, 0);
  expect(pagePosition.top).toBeCloseTo(12, 0);
  expect(pagePosition.scrollX).toBe(0);
  expect(pagePosition.scrollY).toBe(0);
  expect(pagePosition.margins?.left).toBeCloseTo(pagePosition.margins?.right ?? -1, 0);
  expect(pagePosition.margins?.top).toBeCloseTo(pagePosition.margins?.bottom ?? -1, 0);
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

test("clicking a preview character moves the source cursor to that character", async ({ page }) => {
  await page.goto("/");
  const preview = page.frameLocator("iframe.standalone-preview");
  const title = preview.locator(".umber-run-text").filter({ hasText: "A tiny book" });
  await expect(title).toBeVisible();
  const previewPoint = await title.evaluate((element) => {
    const text = element as SVGTextContentElement;
    const unit = text.textContent?.indexOf("tiny") ?? -1;
    if (unit < 0) throw new Error("title unit was not rendered");
    const extent = text.getExtentOfChar(unit);
    const point = text.ownerSVGElement?.createSVGPoint();
    const matrix = text.getScreenCTM();
    if (!point || !matrix) throw new Error("title geometry was unavailable");
    point.x = extent.x + extent.width / 2;
    point.y = extent.y + extent.height / 2;
    const client = point.matrixTransform(matrix);
    return { x: client.x, y: client.y };
  });
  const frameBox = await page.locator("iframe.standalone-preview").boundingBox();
  if (!frameBox) throw new Error("preview frame geometry was unavailable");
  await page.mouse.click(frameBox.x + previewPoint.x, frameBox.y + previewPoint.y);

  const editor = page.locator('[role="textbox"]:visible');
  await expect(editor).toBeFocused();
  await expect(preview.locator(".umber-source-caret")).toBeVisible();
  await editor.click();
  await expect(preview.locator(".umber-source-caret")).toHaveCount(0);
  await editor.evaluate((element) => (element as HTMLElement).blur());
  await page.mouse.click(frameBox.x + previewPoint.x, frameBox.y + previewPoint.y);
  await expect(editor).toBeFocused();
  await expect(preview.locator(".umber-source-caret")).toBeVisible();
  await page.keyboard.insertText("|");
  await expect(editor).toContainText(String.raw`\centerline{A |tiny book about umber}`);
});

test("selecting preview text selects the matching source range", async ({ page }) => {
  await page.goto("/");
  const title = page
    .frameLocator("iframe.standalone-preview")
    .locator(".umber-run-text")
    .filter({ hasText: "A tiny book" });
  await expect(title).toBeVisible();
  const dragFeedback = await title.evaluate((element) => {
    const text = element as SVGTextContentElement;
    const startUnit = text.textContent?.indexOf("tiny") ?? -1;
    const endUnit = startUnit + "tiny".length - 1;
    const matrix = text.getScreenCTM();
    const svg = text.ownerSVGElement;
    if (startUnit < 0 || !matrix || !svg) throw new Error("title geometry was unavailable");
    const toClient = (x: number, y: number) => {
      const point = svg.createSVGPoint();
      point.x = x;
      point.y = y;
      const client = point.matrixTransform(matrix);
      return { x: client.x, y: client.y };
    };
    const start = text.getExtentOfChar(startUnit);
    const end = text.getExtentOfChar(endUnit);
    const startPoint = toClient(start.x + start.width / 2, start.y + start.height / 2);
    const endPoint = toClient(end.x + end.width / 2, end.y + end.height / 2);
    text.dispatchEvent(
      new MouseEvent("mousedown", {
        bubbles: true,
        button: 0,
        clientX: startPoint.x,
        clientY: startPoint.y,
      }),
    );
    text.dispatchEvent(
      new MouseEvent("mousemove", {
        bubbles: true,
        buttons: 1,
        clientX: endPoint.x,
        clientY: endPoint.y,
      }),
    );
    const feedback = text.ownerDocument.getSelection()?.toString();
    text.dispatchEvent(
      new MouseEvent("mouseup", {
        bubbles: true,
        button: 0,
        clientX: endPoint.x,
        clientY: endPoint.y,
      }),
    );
    return feedback;
  });
  expect(dragFeedback).toBe("tiny");
  await expect
    .poll(() => title.evaluate((element) => element.ownerDocument.getSelection()?.toString()))
    .toBe("tiny");

  const editor = page.locator('[role="textbox"]:visible');
  await expect(editor).toBeFocused();
  await page.keyboard.insertText("|");
  await expect(editor).toContainText(String.raw`\centerline{A | book about umber}`);
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
  const [sumBox, upperLimitBox] = await Promise.all([
    sum.boundingBox(),
    preview.locator(".umber-run-text").filter({ hasText: "y" }).first().boundingBox(),
  ]);
  expect(sumBox?.width).toBeGreaterThan(0);
  expect(sumBox?.height).toBeGreaterThan(0);
  expect((upperLimitBox?.y ?? 0) + (upperLimitBox?.height ?? 0)).toBeLessThanOrEqual(
    (sumBox?.y ?? 0) + 1,
  );
  await expect(page.getByText("No diagnostics.")).toBeVisible();
});

test("renders LaTeX title and math fonts used by the sample document", async ({ page }) => {
  await page.goto("/");
  const preview = page.frameLocator("iframe.standalone-preview");

  await page.getByRole("combobox", { name: "Project compile format" }).selectOption("latex");
  await page.waitForTimeout(250);
  await expect(page.getByRole("status")).toContainText("idle");
  const editor = page.locator('[role="textbox"]:visible');
  await editor.focus();
  await page.keyboard.press("Control+A");
  await page.keyboard.insertText(String.raw`\documentclass{article}
\usepackage{amsmath}
\title{Simple Sample}
\author{My Name}
\date{}
\begin{document}
\maketitle
Today I am learning \LaTeX. \LaTeX{} is a great program for writing math.
Inline math: $a^2+b^2=c^2$.
\begin{equation}
\gamma^2+\theta^2=\omega^2
\end{equation}
\end{document}`);

  await expect(preview.locator("body")).toContainText("Simple Sample", { timeout: 30_000 });
  await expect(preview.locator(".umber-run-text").filter({ hasText: "γ" })).toBeVisible();
  await expect(preview.locator(".umber-run-text").filter({ hasText: "θ" })).toBeVisible();
  await expect(preview.locator(".umber-run-text").filter({ hasText: "ω" })).toBeVisible();
  await expect(preview.locator(".umber-run-text").filter({ hasText: "(1)" })).toBeVisible();
  const logoOffsets = await preview.locator(".umber-page").evaluate((page) => {
    const runs = Array.from(page.querySelectorAll<SVGTextElement>(".umber-run-text"));
    const offsets: number[] = [];
    for (let index = 1; index < runs.length - 3; index += 1) {
      const a = runs[index];
      const lRun = runs[index - 1];
      if (
        a.textContent !== "A" ||
        runs[index + 1].textContent !== "T" ||
        runs[index + 2].textContent !== "E" ||
        !runs[index + 3].textContent?.startsWith("X") ||
        !lRun.textContent?.endsWith("L")
      )
        continue;
      const lNode = lRun.firstChild;
      const lLength = lNode?.textContent?.length ?? 0;
      if (!lNode || lLength === 0) continue;
      const lRange = page.ownerDocument.createRange();
      lRange.setStart(lNode, lLength - 1);
      lRange.setEnd(lNode, lLength);
      offsets.push(a.getBoundingClientRect().left - lRange.getBoundingClientRect().left);
    }
    return offsets;
  });
  expect(logoOffsets).toHaveLength(2);
  expect(logoOffsets[0]).toBeCloseTo(logoOffsets[1], 2);
  await expect(page.getByText("No diagnostics.")).toBeVisible();
});

test("renders packaged TFM and OpenType-only text faces", async ({ page }) => {
  await page.goto("/");
  const editor = page.locator('[role="textbox"]:visible');
  const preview = page.frameLocator("iframe.standalone-preview");

  await editor.focus();
  await page.keyboard.press("Control+A");
  await page.keyboard.insertText(
    String.raw`{\bf Bold}\par
{\sl Slanted}\par
{\it Italic}\par
{\tt Typewriter}\par
\font\sc=cmcsc10 \sc Small Caps\par
\font\sf=cmss10 \sf Sans Serif\par
\font\roman=cmr10 \roman Roman\par
\font\unicode=opentype:cmr10 \unicode OpenType only\par
\bye`,
  );

  await expect(preview.locator("body")).toContainText("Bold");
  await expect(preview.locator("body")).toContainText("Small Caps");
  await expect(preview.locator("body")).toContainText("Sans Serif");
  await expect(preview.locator("body")).toContainText("Roman");
  await expect(preview.locator("body")).toContainText("OpenType only");
  await expect(page.getByText("No diagnostics.")).toBeVisible();
  await expect(page.getByText(/Engine recovery started automatically/)).toHaveCount(0);
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
