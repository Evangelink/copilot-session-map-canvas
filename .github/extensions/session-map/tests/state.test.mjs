import assert from "node:assert/strict";
import test from "node:test";

import {
    classifyToolActivity,
    completeSession,
    createState,
    recordSemanticStep,
    recordToolActivity,
    recordUserGoal,
    StateValidationError,
} from "../state.mjs";

const START = "2026-08-04T12:00:00.000Z";

function state() {
    return createState({
        sessionId: "session-1",
        documentId: "session-1",
        timestamp: START,
    });
}

test("records a user goal once and uses it as the first graph node", () => {
    const value = state();
    recordUserGoal(value, "Build a useful session map.", START);
    recordUserGoal(value, "Build a useful session map.", START);

    assert.equal(value.steps.length, 1);
    assert.equal(value.steps[0].kind, "goal");
    assert.deepEqual(value.steps[0].dependencies, []);
});

test("aggregates related tools and completes a phase on category change", () => {
    const value = state();
    recordUserGoal(value, "Implement the feature.", START);
    recordToolActivity(value, {
        toolName: "rg",
        status: "success",
        timestamp: "2026-08-04T12:01:00.000Z",
    });
    recordToolActivity(value, {
        toolName: "view",
        status: "success",
        timestamp: "2026-08-04T12:02:00.000Z",
    });
    recordToolActivity(value, {
        toolName: "apply_patch",
        status: "success",
        timestamp: "2026-08-04T12:03:00.000Z",
    });

    assert.equal(value.steps.length, 3);
    assert.equal(value.steps[1].activityCount, 2);
    assert.equal(value.steps[1].status, "success");
    assert.equal(value.steps[2].category, "implementation");
    assert.equal(value.steps[2].status, "in_progress");
    assert.deepEqual(value.steps[2].dependencies, [value.steps[1].id]);
});

test("preserves failed tool phase state", () => {
    const value = state();
    recordToolActivity(value, {
        toolName: "powershell",
        status: "failure",
        timestamp: START,
    });

    assert.equal(value.steps[0].status, "failure");
    assert.match(value.steps[0].description, /powershell failed/);
    assert.equal(value.activePhaseId, null);
});

test("records and updates an explicit semantic milestone", () => {
    const value = state();
    recordSemanticStep(
        value,
        {
            id: "renderer",
            title: "Building renderer",
            status: "in_progress",
        },
        { timestamp: START },
    );
    recordSemanticStep(
        value,
        {
            id: "renderer",
            title: "Built renderer",
            description: "Timeline and graph are available.",
            status: "success",
        },
        { timestamp: "2026-08-04T12:05:00.000Z" },
    );

    assert.equal(value.steps.length, 1);
    assert.equal(value.steps[0].title, "Built renderer");
    assert.equal(value.steps[0].status, "success");
});

test("allocates an id when an optional semantic step id is omitted or empty", () => {
    const value = state();
    recordSemanticStep(
        value,
        { title: "First milestone" },
        { timestamp: START },
    );
    recordSemanticStep(
        value,
        { id: "", title: "Second milestone" },
        { timestamp: "2026-08-04T12:01:00.000Z" },
    );

    assert.deepEqual(
        value.steps.map((step) => step.id),
        ["step-1", "step-2"],
    );
    assert.deepEqual(value.steps[1].dependencies, ["step-1"]);
});

test("rejects missing and cyclic dependencies", () => {
    const value = state();
    recordSemanticStep(
        value,
        { id: "one", title: "One" },
        { timestamp: START },
    );
    assert.throws(
        () =>
            recordSemanticStep(
                value,
                { id: "two", title: "Two", dependsOn: ["missing"] },
                { timestamp: START },
            ),
        StateValidationError,
    );
    recordSemanticStep(
        value,
        { id: "two", title: "Two", dependsOn: ["one"] },
        { timestamp: START },
    );
    assert.throws(
        () =>
            recordSemanticStep(
                value,
                { id: "one", title: "One", dependsOn: ["two"] },
                { timestamp: START },
            ),
        /create a cycle/,
    );
});

test("completion finalizes the active phase and records the outcome", () => {
    const value = state();
    recordToolActivity(value, {
        toolName: "node_test",
        status: "success",
        timestamp: START,
    });
    completeSession(value, {
        reason: "complete",
        timestamp: "2026-08-04T12:06:00.000Z",
    });

    assert.equal(value.steps[0].status, "success");
    assert.equal(value.steps.at(-1).kind, "completion");
    assert.equal(value.completion.status, "success");
});

test("classifies commands without persisting command contents", () => {
    assert.equal(
        classifyToolActivity("powershell", { command: "npm test" }),
        "validation",
    );
    assert.equal(
        classifyToolActivity("powershell", { command: "git push origin HEAD" }),
        "publication",
    );
});
