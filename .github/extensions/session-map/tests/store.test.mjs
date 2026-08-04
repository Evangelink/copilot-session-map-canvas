import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { recordSemanticStep } from "../state.mjs";
import { StateStore } from "../store.mjs";

test("a read waits for but does not inherit a failed mutation", async (context) => {
    const workspacePath = await fs.mkdtemp(join(tmpdir(), "session-map-store-"));
    context.after(() =>
        fs.rm(workspacePath, { force: true, recursive: true }),
    );
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

test("Windows replacement fallback restores prior state when replacement fails", async (context) => {
    const workspacePath = await fs.mkdtemp(join(tmpdir(), "session-map-store-"));
    context.after(() =>
        fs.rm(workspacePath, { force: true, recursive: true }),
    );
    const baselineStore = new StateStore({
        workspacePath,
        sessionId: "session-1",
    });
    await baselineStore.ensure("session-1");
    const path = baselineStore.pathFor("session-1");
    const original = await fs.readFile(path, "utf8");

    let renameCall = 0;
    const simulatedWindowsFileSystem = {
        ...fs,
        async rename(source, destination) {
            renameCall += 1;
            if (renameCall === 1) {
                const error = new Error("destination exists");
                error.code = "EPERM";
                throw error;
            }
            if (renameCall === 3) {
                const error = new Error("simulated replacement failure");
                error.code = "EIO";
                throw error;
            }
            return fs.rename(source, destination);
        },
    };
    const store = new StateStore({
        workspacePath,
        sessionId: "session-1",
        fileSystem: simulatedWindowsFileSystem,
    });
    const updated = await store.read("session-1");
    updated.view = "graph";

    await assert.rejects(
        store.save("session-1", updated),
        /simulated replacement failure/,
    );
    assert.equal(await fs.readFile(path, "utf8"), original);
    assert.equal(renameCall, 4);
});

test("loads a persisted version 1 document without usage fields", async (context) => {
    const workspacePath = await fs.mkdtemp(join(tmpdir(), "session-map-store-"));
    context.after(() =>
        fs.rm(workspacePath, { force: true, recursive: true }),
    );
    const store = new StateStore({
        workspacePath,
        sessionId: "session-1",
    });
    const path = store.pathFor("session-1");
    await fs.mkdir(join(workspacePath, ".copilot", "session-map"), {
        recursive: true,
    });
    await fs.writeFile(
        path,
        JSON.stringify({
            version: 1,
            documentId: "session-1",
            sessionId: "session-1",
            view: "timeline",
            nextSequence: 2,
            steps: [
                {
                    id: "goal-1",
                    kind: "goal",
                    title: "Existing goal",
                    description: "Written before usage tracking.",
                    status: "success",
                    source: "automatic",
                    category: null,
                    dependencies: [],
                    toolNames: [],
                    activityCount: 0,
                    createdAt: "2026-08-04T12:00:00.000Z",
                    updatedAt: "2026-08-04T12:00:00.000Z",
                },
            ],
        }),
        "utf8",
    );

    const loaded = await store.load("session-1");

    assert.equal(loaded.usage, undefined);
    assert.equal(loaded.steps[0].usage, undefined);
    assert.equal(loaded.steps[0].title, "Existing goal");
});
