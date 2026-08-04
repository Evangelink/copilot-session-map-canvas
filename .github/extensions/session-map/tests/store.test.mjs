import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { recordSemanticStep } from "../state.mjs";
import { StateStore } from "../store.mjs";

test("a read waits for but does not inherit a failed mutation", async (context) => {
    const workspacePath = await mkdtemp(join(tmpdir(), "session-map-store-"));
    context.after(() => rm(workspacePath, { force: true, recursive: true }));
    const store = new StateStore({
        workspacePath,
        sessionId: "session-1",
    });
    await store.ensure("session-1");

    const failedMutation = store.mutate("session-1", (state) =>
        recordSemanticStep(state, {
            id: "invalid",
            title: "Invalid dependency",
            dependsOn: ["missing"],
        }),
    );
    const concurrentRead = store.read("session-1");

    await assert.rejects(failedMutation, /does not exist/);
    const persisted = await concurrentRead;
    assert.deepEqual(persisted.steps, []);
});
