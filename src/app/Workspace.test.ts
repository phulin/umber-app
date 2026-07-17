import { createComponent } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it } from "vitest";
import { FakeEngineTransport } from "../features/tex-compile/engineTransport";
import { Workspace, workspaceProjectFiles } from "./Workspace";

let dispose: (() => void) | undefined;

afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.innerHTML = "";
});

describe("workspaceProjectFiles", () => {
  it("preserves binary resources while encoding editable documents", () => {
    const binary = new Uint8Array([0, 255, 4, 9]);
    const files = workspaceProjectFiles(
      [{ id: "main", path: "main.tex", text: "hello" }],
      [{ id: "plot", path: "figures/plot.png", bytes: binary }],
    );

    expect(files.map(({ path }) => path)).toEqual(["main.tex", "figures/plot.png"]);
    expect(new TextDecoder().decode(files[0]?.bytes)).toBe("hello");
    expect([...new Uint8Array(files[1]?.bytes ?? new ArrayBuffer())]).toEqual([0, 255, 4, 9]);
    expect(files[1]?.bytes).not.toBe(binary.buffer);
  });
});

describe("Workspace recovery notice", () => {
  it("shows and dismisses an alert when automatic engine recovery starts", async () => {
    const root = document.createElement("div");
    document.body.append(root);
    const transport = new FakeEngineTransport([
      {
        afterMessage: "openProject",
        emit: { t: "fatal", message: "worker panic", kind: "worker" },
      },
    ]);

    dispose = render(
      () =>
        createComponent(Workspace, {
          name: "Recovery test",
          documents: [{ id: "main", path: "main.tex", text: "Hello" }],
          entry: "main.tex",
          compileMode: "plain",
          engineTransport: transport,
        }),
      root,
    );
    await new Promise((resolve) => setTimeout(resolve, 20));

    const alert = root.querySelector<HTMLElement>('[role="alert"]');
    expect(alert?.textContent).toContain("Engine recovery started automatically · worker panic");
    alert?.querySelector<HTMLButtonElement>("button")?.click();
    expect(root.querySelector('[role="alert"]')).toBeNull();
  });
});
