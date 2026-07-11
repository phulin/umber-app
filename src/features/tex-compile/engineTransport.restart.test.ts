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
    transports[0]?.emit({ t: "fatal", message: "wasm panic" });

    expect(restartable.restartCount).toBe(1);
    expect(transports).toHaveLength(2);
    expect(transports[0]?.received.map(({ t }) => t)).toEqual(["init", "openProject"]);
    expect(transports[1]?.received.map(({ t }) => t)).toEqual(["init", "openProject"]);
    const replayed = transports[1]?.received[1];
    expect(replayed?.t === "openProject" ? replayed.files[0]?.bytes : undefined).not.toBe(
      projectBytes,
    );
    restartable.terminate();
  });
});
