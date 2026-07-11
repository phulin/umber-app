import { describe, expect, it, vi } from "vitest";
import type { EditorDelta } from "../editor/CodeEditor";
import { CompileOrchestrator } from "./compileOrchestrator";
import { FakeEngineTransport } from "./engineTransport";

const delta = (fromByte: number, toByte: number, insertedText: string): EditorDelta => ({
  docId: "main",
  fromUtf16: fromByte,
  toUtf16: toByte,
  fromByte,
  toByte,
  insertedText,
});

const setup = () => {
  const transport = new FakeEngineTransport();
  const orchestrator = new CompileOrchestrator(transport);
  orchestrator.initialize(
    { t: "init", bundleDigest: "bundle", engineOpts: {} },
    {
      entry: "main.tex",
      files: [
        {
          docId: "main",
          path: "main.tex",
          bytes: new TextEncoder().encode("abc").buffer,
        },
      ],
    },
  );
  return { transport, orchestrator };
};

describe("CompileOrchestrator", () => {
  it("forwards normal edits immediately with cancellation", () => {
    const { transport, orchestrator } = setup();
    orchestrator.submitEdit(delta(1, 1, "X"));

    expect(transport.received.map(({ t }) => t)).toEqual(["init", "openProject", "cancel", "edit"]);
    expect(transport.received.at(-1)).toMatchObject({
      t: "edit",
      epoch: 1,
      fromByte: 1,
      toByte: 1,
    });
    orchestrator.dispose();
  });

  it("coalesces all saturated edits into one minimal delta when the engine is idle", () => {
    const { transport, orchestrator } = setup();
    transport.emit({ t: "saturated", queuedDeltas: 3 });
    orchestrator.submitEdit(delta(1, 1, "X"));
    orchestrator.submitEdit(delta(2, 2, "Y"));

    expect(orchestrator.editEpoch).toBe(2);
    expect(transport.received).toHaveLength(2);
    transport.emit({ t: "progress", epoch: 0, phase: "idle" });

    expect(transport.received.map(({ t }) => t)).toEqual(["init", "openProject", "cancel", "edit"]);
    const edit = transport.received.at(-1);
    expect(edit).toMatchObject({ t: "edit", epoch: 2, fromByte: 1, toByte: 1 });
    expect(edit?.t === "edit" ? new TextDecoder().decode(edit.insert) : "").toBe("XY");
    orchestrator.dispose();
  });

  it("uses stale idle progress for control flow without exposing superseded output", () => {
    const { transport, orchestrator } = setup();
    const listener = vi.fn();
    orchestrator.subscribe(listener);
    transport.emit({ t: "saturated", queuedDeltas: 1 });
    orchestrator.submitEdit(delta(1, 1, "X"));
    transport.emit({ t: "diagnostics", epoch: 0, items: [] });
    transport.emit({ t: "progress", epoch: 0, phase: "idle" });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({ t: "saturated", queuedDeltas: 1 });
    expect(transport.received.at(-1)).toMatchObject({ t: "edit", epoch: 1 });
    orchestrator.dispose();
  });

  it("transfers binary resources without decoding them into editable state", () => {
    const transport = new FakeEngineTransport();
    const orchestrator = new CompileOrchestrator(transport);
    const binary = new Uint8Array([0xff, 0xfe, 0xfd]).buffer;
    orchestrator.initialize(
      { t: "init", bundleDigest: "bundle", engineOpts: {} },
      {
        entry: "main.tex",
        editableDocIds: new Set(["main"]),
        files: [
          { docId: "main", path: "main.tex", bytes: new TextEncoder().encode("main").buffer },
          { docId: "plot", path: "plot.png", bytes: binary },
        ],
      },
    );

    expect(transport.received[1]).toMatchObject({ t: "openProject" });
    expect(() =>
      orchestrator.submitEdit({
        docId: "plot",
        fromUtf16: 0,
        toUtf16: 0,
        fromByte: 0,
        toByte: 0,
        insertedText: "x",
      }),
    ).toThrow("Unknown document: plot");
    orchestrator.dispose();
  });
});
