import { describe, expect, it, vi } from "vitest";
import { paragraphEditReplay } from "./__fixtures__/paragraph-edit";
import { CompileSession } from "./compileSession";
import { FakeEngineTransport } from "./engineTransport";
import type { FromEngine } from "./protocol";

const emptyPatch = (epoch: number): FromEngine => ({
  t: "patch",
  epoch,
  pages: [],
  removePages: [],
  blocks: [],
  removeBlocks: [],
  spans: [],
  final: true,
});

describe("CompileSession", () => {
  it("increments edit epochs and cancels superseded work before every edit", () => {
    const transport = new FakeEngineTransport();
    const session = new CompileSession(transport);

    expect(session.edit("main", 5, 5, "a")).toBe(1);
    expect(session.edit("main", 6, 6, "b")).toBe(2);

    expect(transport.received.map(({ t }) => t)).toEqual(["cancel", "edit", "cancel", "edit"]);
    expect(transport.received[0]).toEqual({ t: "cancel", beforeEpoch: 1 });
    expect(transport.received[2]).toEqual({ t: "cancel", beforeEpoch: 2 });
    session.dispose();
  });

  it("drops patches, diagnostics, and progress older than the last applied epoch", () => {
    const transport = new FakeEngineTransport();
    const session = new CompileSession(transport);
    const listener = vi.fn();
    session.subscribe(listener);

    transport.emit(emptyPatch(2));
    transport.emit(emptyPatch(1));
    transport.emit({ t: "diagnostics", epoch: 1, items: [] });
    transport.emit({ t: "progress", epoch: 1, phase: "idle" });
    transport.emit({ t: "diagnostics", epoch: 2, items: [] });

    expect(session.latestAppliedEpoch).toBe(2);
    expect(
      listener.mock.calls.map((call) => {
        const message = call[0] as FromEngine;
        return [message.t, "epoch" in message ? message.epoch : null];
      }),
    ).toEqual([
      ["patch", 2],
      ["diagnostics", 2],
    ]);
    session.dispose();
  });

  it("replays the recorded golden stream through the fake engine", async () => {
    const transport = new FakeEngineTransport(paragraphEditReplay);
    const session = new CompileSession(transport);
    const received: FromEngine[] = [];
    session.subscribe((message) => received.push(message));

    session.send({ t: "init", bundleDigest: "test-bundle", engineOpts: {} });
    session.edit("main", 41, 46, "Hello, Umber.");
    await new Promise<void>((resolve) => queueMicrotask(resolve));

    expect(received.map(({ t }) => t)).toEqual([
      "ready",
      "progress",
      "patch",
      "diagnostics",
      "progress",
    ]);
    expect(session.latestAppliedEpoch).toBe(1);
    session.dispose();
  });

  it("ignores unknown messages without notifying subscribers", () => {
    const transport = new FakeEngineTransport();
    const session = new CompileSession(transport);
    const listener = vi.fn();
    session.subscribe(listener);

    transport.emit({ t: "newerEngineEvent", payload: true });

    expect(listener).not.toHaveBeenCalled();
    session.dispose();
  });
});
