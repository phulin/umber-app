import { describe, expect, it } from "vitest";
import { paragraphEditGolden } from "./__fixtures__/paragraph-edit";
import { decodeFromEngine, decodeToEngine, type ToEngine, transferablesFor } from "./protocol";

describe("engine protocol boundary", () => {
  it("accepts every message in the paragraph-edit golden stream", () => {
    expect(paragraphEditGolden.map(decodeFromEngine)).toEqual(paragraphEditGolden);
  });

  it("ignores unknown messages for forward compatibility", () => {
    expect(decodeFromEngine({ t: "engineCapability", name: "future-feature" })).toBeNull();
    expect(decodeToEngine({ t: "futureCommand", enabled: true })).toBeNull();
  });

  it("rejects malformed known messages", () => {
    expect(
      decodeFromEngine({
        t: "diagnostics",
        epoch: 1,
        items: [
          {
            severity: "critical",
            docId: "main",
            byteStart: 2,
            byteEnd: 1,
            message: "invalid",
          },
        ],
      }),
    ).toBeNull();
  });

  it("lists large buffers as transferables", () => {
    const insert = new Uint8Array([1, 2, 3]).buffer;
    const edit: ToEngine = {
      t: "edit",
      epoch: 1,
      docId: "main",
      fromByte: 0,
      toByte: 0,
      insert,
    };

    expect(transferablesFor(edit)).toEqual([insert]);
    const patch = paragraphEditGolden[2];
    expect(patch?.t).toBe("patch");
    expect(transferablesFor(patch)).toEqual(patch.t === "patch" ? [patch.blocks[0]?.html] : []);
  });

  it("validates the main-thread side of the protocol", () => {
    expect(
      decodeToEngine({
        t: "edit",
        epoch: 3,
        docId: "main",
        fromByte: 4,
        toByte: 6,
        insert: new ArrayBuffer(2),
      }),
    ).not.toBeNull();
    expect(
      decodeToEngine({
        t: "edit",
        epoch: 3,
        docId: "main",
        fromByte: 7,
        toByte: 6,
        insert: new ArrayBuffer(2),
      }),
    ).toBeNull();
  });
});
