import { describe, expect, it } from "vitest";
import { createDemoEngineTransport } from "./demoEngineTransport";
import { listenToEngine } from "./engineTransport";
import type { FromEngine } from "./protocol";

describe("interactive demo engine", () => {
  it("updates byte state and emits a new patch for every edit", async () => {
    const transport = createDemoEngineTransport();
    const messages: FromEngine[] = [];
    listenToEngine(transport, (message) => messages.push(message));
    const source = "\\begin{document}\nHello\n\\end{document}";
    transport.postMessage({ t: "init", bundleDigest: "demo", engineOpts: {} });
    transport.postMessage({
      t: "openProject",
      entry: "main.tex",
      compileMode: "plain",
      files: [
        {
          docId: "main",
          path: "main.tex",
          bytes: encoder.encode(source).buffer,
        },
      ],
    });
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    const fromByte = encoder.encode("\\begin{document}\n").byteLength;
    transport.postMessage({ t: "cancel", beforeEpoch: 1 });
    transport.postMessage({
      t: "edit",
      epoch: 1,
      docId: "main",
      fromByte,
      toByte: fromByte + encoder.encode("Hello").byteLength,
      insert: encoder.encode("Updated").buffer,
    });
    await new Promise<void>((resolve) => queueMicrotask(resolve));

    const patches = messages.filter(
      (message): message is Extract<FromEngine, { t: "patch" }> => message.t === "patch",
    );
    expect(patches.map(({ epoch }) => epoch)).toEqual([0, 1]);
    expect(new TextDecoder().decode(patches[1]?.blocks[0]?.html)).toContain("Updated");
    expect(messages.at(-1)).toEqual({ t: "progress", epoch: 1, phase: "idle" });
    transport.terminate();
  });
});

const encoder = new TextEncoder();
