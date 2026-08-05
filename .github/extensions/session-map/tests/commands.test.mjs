import assert from "node:assert/strict";
import test from "node:test";

import { createMapCommand } from "../commands.mjs";

test("map command opens a stable Session Map canvas instance", async () => {
    const openRequests = [];
    const command = createMapCommand({
        listOpenCanvases: async () => ({ openCanvases: [] }),
        openCanvas: async (input) => {
            openRequests.push(input);
        },
    });

    assert.equal(command.name, "map");
    assert.equal(command.description, "Open or focus the Session Map.");

    await command.handler();
    await command.handler();

    assert.deepEqual(openRequests, [
        {
            extensionId: "session-map:session-map",
            canvasId: "session-map",
            instanceId: "session-map-command",
        },
        {
            extensionId: "session-map:session-map",
            canvasId: "session-map",
            instanceId: "session-map-command",
        },
    ]);
});

test("map command focuses an existing Session Map canvas", async () => {
    const openRequests = [];
    const command = createMapCommand({
        listOpenCanvases: async () => ({
            openCanvases: [
                {
                    canvasId: "session-map",
                    extensionId: "foreign:session-map",
                    instanceId: "foreign-map",
                },
                {
                    canvasId: "session-map",
                    extensionId: "session-map:session-map",
                    instanceId: "agent-opened-map",
                },
            ],
        }),
        openCanvas: async (input) => {
            openRequests.push(input);
        },
    });

    await command.handler();

    assert.deepEqual(openRequests, [
        {
            canvasId: "session-map",
            extensionId: "session-map:session-map",
            instanceId: "agent-opened-map",
        },
    ]);
});

test("map command propagates canvas errors", async () => {
    const expected = new Error("canvas unavailable");
    const command = createMapCommand({
        listOpenCanvases: async () => ({ openCanvases: [] }),
        openCanvas: async () => {
            throw expected;
        },
    });

    await assert.rejects(command.handler(), expected);
});
