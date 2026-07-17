import { render } from "solid-js/web";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "./App";

let dispose: (() => void) | undefined;

afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.innerHTML = "";
});

describe("App", () => {
  it("renders the demo workspace shell", async () => {
    const root = document.createElement("div");
    document.body.append(root);

    dispose = render(() => <App />, root);

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(root.textContent).toContain("Browser-native TeX");
    expect(root.textContent).toContain("HTML Preview");
    expect(root.querySelector('[aria-label="Project compile format"]')).not.toBeNull();
  });
});
