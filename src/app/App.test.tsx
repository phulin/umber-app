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
  it("renders the workspace shell", () => {
    const root = document.createElement("div");
    document.body.append(root);

    dispose = render(() => <App />, root);

    expect(root.querySelector("h1")?.textContent).toBe("Local LaTeX workspace");
    expect(root.textContent).toContain("HTML Preview");
  });
});
