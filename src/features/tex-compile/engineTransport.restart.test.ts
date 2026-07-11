import { describe, expect, it } from "vitest";
import { FakeEngineTransport, RestartableEngineTransport } from "./engineTransport";

describe("RestartableEngineTransport", () => {
  it("recreates a failed worker and reloads its project bootstrap", () => {
    const transports: FakeEngineTransport[] = [];
    const restartable = new RestartableEngineTransport(() => {
      const transport = new FakeEngineTransport();
      transports.push(transport);
      return transport;
    });
    const projectBytes = new TextEncoder().encode("source").buffer;

    restartable.postMessage({ t: "init", bundleDigest: "bundle", engineOpts: {} });
    restartable.postMessage({
      t: "openProject",
      entry: "main.tex",
      files: [{ docId: "main", path: "main.tex", bytes: projectBytes }],
    });
    restartable.postMessage({
      t: "edit",
      epoch: 1,
      docId: "main",
      fromByte: 0,
      toByte: 6,
      insert: new TextEncoder().encode("updated").buffer,
    });
    transports[0]?.emit({ t: "fatal", message: "wasm panic" });

    expect(restartable.restartCount).toBe(1);
    expect(transports).toHaveLength(2);
    expect(transports[0]?.received.map(({ t }) => t)).toEqual(["init", "openProject", "edit"]);
    expect(transports[1]?.received.map(({ t }) => t)).toEqual(["init", "openProject"]);
    const replayed = transports[1]?.received[1];
    expect(replayed?.t === "openProject" ? replayed.files[0]?.bytes : undefined).not.toBe(
      projectBytes,
    );
    expect(
      replayed?.t === "openProject"
        ? new TextDecoder().decode(replayed.files[0]?.bytes)
        : undefined,
    ).toBe("updated");
    restartable.terminate();
  });

  it("turns a hard worker error into a visible fatal and automatic reload", () => {
    const transports: FakeEngineTransport[] = [];
    const restartable = new RestartableEngineTransport(() => {
      const transport = new FakeEngineTransport();
      transports.push(transport);
      return transport;
    });
    const messages: unknown[] = [];
    restartable.addEventListener("message", ({ data }) => messages.push(data));
    restartable.postMessage({ t: "init", bundleDigest: "bundle", engineOpts: {} });
    restartable.postMessage({
      t: "openProject",
      entry: "main.tex",
      files: [{ docId: "main", path: "main.tex", bytes: new ArrayBuffer(1) }],
    });

    transports[0]?.emitError(new Error("worker terminated"));

    expect(messages).toContainEqual({
      t: "fatal",
      message: "worker terminated",
      kind: "worker",
    });
    expect(restartable.restartCount).toBe(1);
    expect(transports[1]?.received.map(({ t }) => t)).toEqual(["init", "openProject"]);
    restartable.terminate();
  });
});
