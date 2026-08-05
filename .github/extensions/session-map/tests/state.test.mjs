import assert from "node:assert/strict";
import test from "node:test";

import {
    classifyToolActivity,
    completeToolChatEvent,
    completeSession,
    createState,
    normalizeState,
    recordChatEvent,
    recordSemanticStep,
    recordToolActivity,
    recordTurnStart,
    recordUsage,
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

test("correlates chat, turn, message, and tool anchors with session steps", () => {
    const value = state();
    recordUserGoal(value, "Implement synchronized navigation.", START);
    recordChatEvent(value, {
        id: "event-user",
        type: "user",
        title: "You",
        content: "Implement synchronized navigation.",
        timestamp: START,
    });
    recordTurnStart(value, {
        turnId: "turn-1",
        timestamp: "2026-08-04T12:00:01.000Z",
    });
    recordToolActivity(value, {
        toolName: "apply_patch",
        status: "success",
        timestamp: "2026-08-04T12:01:00.000Z",
    });
    recordChatEvent(value, {
        id: "event-tool-start",
        type: "tool",
        stepId: value.lastRecordedStepId,
        title: "apply_patch",
        content: "apply_patch started.",
        toolCallId: "tool-1",
        turnId: "turn-1",
        timestamp: "2026-08-04T12:01:00.000Z",
    });
    completeToolChatEvent(value, {
        id: "event-tool-complete",
        toolCallId: "tool-1",
        success: true,
        timestamp: "2026-08-04T12:01:01.000Z",
    });
    recordChatEvent(value, {
        id: "event-assistant",
        type: "assistant",
        title: "Copilot",
        content: "Synchronization is implemented.",
        messageId: "message-1",
        turnId: "turn-1",
        timestamp: "2026-08-04T12:02:00.000Z",
    });

    assert.equal(value.chatEvents.length, 3);
    assert.equal(value.chatEvents[1].status, "success");
    assert.equal(value.activeChatStepId, value.steps[1].id);
    assert.deepEqual(value.steps[0].chat.eventIds, ["event-user"]);
    assert.deepEqual(value.steps[1].chat.eventIds, [
        "event-tool-start",
        "event-tool-complete",
        "event-assistant",
    ]);
    assert.deepEqual(value.steps[1].chat.turnIds, ["turn-1"]);
    assert.deepEqual(value.steps[1].chat.messageIds, ["message-1"]);
});

test("marks a correlated tool phase as failed on completion", () => {
    const value = state();
    recordToolActivity(value, {
        toolName: "powershell",
        status: "success",
        timestamp: START,
    });
    recordChatEvent(value, {
        id: "tool-start",
        type: "tool",
        title: "powershell",
        toolCallId: "tool-1",
        timestamp: START,
    });
    completeToolChatEvent(value, {
        id: "tool-complete",
        toolCallId: "tool-1",
        success: false,
        timestamp: "2026-08-04T12:00:01.000Z",
    });

    assert.equal(value.steps[0].status, "failure");
    assert.equal(value.activePhaseId, null);
    assert.equal(value.chatEvents[0].status, "failure");
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

test("generated ids skip explicit ids for steps, goals, and phases", () => {
    const stepState = state();
    recordSemanticStep(
        stepState,
        { id: "step-1", title: "Explicit step" },
        { timestamp: START },
    );
    recordSemanticStep(
        stepState,
        { title: "Generated step" },
        { timestamp: "2026-08-04T12:01:00.000Z" },
    );
    assert.deepEqual(
        stepState.steps.map((step) => step.id),
        ["step-1", "step-2"],
    );

    const goalState = state();
    recordSemanticStep(
        goalState,
        { id: "goal-1", title: "Explicit goal id" },
        { timestamp: START },
    );
    recordUserGoal(
        goalState,
        "Generated goal.",
        "2026-08-04T12:01:00.000Z",
    );
    assert.deepEqual(
        goalState.steps.map((step) => step.id),
        ["goal-1", "goal-2"],
    );

    const phaseState = state();
    recordSemanticStep(
        phaseState,
        { id: "phase-1", title: "Explicit phase id" },
        { timestamp: START },
    );
    recordToolActivity(phaseState, {
        toolName: "rg",
        status: "success",
        timestamp: "2026-08-04T12:01:00.000Z",
    });
    assert.deepEqual(
        phaseState.steps.map((step) => step.id),
        ["phase-1", "phase-2"],
    );
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

test("attributes exact token usage to the active step and session", () => {
    const value = state();
    recordUserGoal(value, "Implement token tracking.", START);
    recordUsage(value, {
        inputTokens: 100,
        outputTokens: 25,
        cacheReadTokens: 40,
        cacheWriteTokens: 10,
        totalNanoAiu: 1_250_000_000,
        timestamp: "2026-08-04T12:01:00.000Z",
    });
    recordToolActivity(value, {
        toolName: "apply_patch",
        status: "success",
        timestamp: "2026-08-04T12:02:00.000Z",
    });
    recordUsage(value, {
        inputTokens: 200,
        outputTokens: 50,
        cacheReadTokens: 75,
        totalNanoAiu: 2_500_000_000,
        timestamp: "2026-08-04T12:03:00.000Z",
    });

    assert.deepEqual(value.usage, {
        inputTokens: 300,
        outputTokens: 75,
        cacheReadTokens: 115,
        cacheWriteTokens: 10,
        totalTokens: 375,
        totalNanoAiu: 3_750_000_000,
        modelCalls: 2,
    });
    assert.equal(value.steps[0].usage.totalTokens, 125);
    assert.equal(value.steps[0].usage.totalNanoAiu, 1_250_000_000);
    assert.equal(value.steps[1].usage.totalTokens, 250);
    assert.equal(value.steps[1].usage.totalNanoAiu, 2_500_000_000);
});

test("records AI Credit when token counts are unavailable", () => {
    const value = state();
    recordUserGoal(value, "Track AI Credit.", START);

    recordUsage(value, {
        totalNanoAiu: 500_000_000,
        timestamp: "2026-08-04T12:01:00.000Z",
    });

    assert.deepEqual(value.usage, {
        totalNanoAiu: 500_000_000,
        modelCalls: 1,
    });
    assert.equal(value.steps[0].usage.totalNanoAiu, 500_000_000);
});

test("does not report a total when an attributed call lacks input or output", () => {
    const value = state();
    recordUserGoal(value, "Track supported usage only.", START);
    recordUsage(value, {
        inputTokens: 100,
        outputTokens: 25,
        timestamp: "2026-08-04T12:01:00.000Z",
    });
    recordUsage(value, {
        inputTokens: 50,
        timestamp: "2026-08-04T12:02:00.000Z",
    });

    assert.equal(value.usage.inputTokens, 150);
    assert.equal(value.usage.outputTokens, 25);
    assert.equal(value.usage.totalTokens, undefined);
    assert.equal(value.steps[0].usage.totalTokens, undefined);
});

test("attributes usage to the latest semantic milestone", () => {
    const value = state();
    recordSemanticStep(
        value,
        {
            id: "implementation",
            title: "Implementing usage",
            status: "in_progress",
        },
        { timestamp: START },
    );
    recordUsage(value, {
        inputTokens: 80,
        outputTokens: 20,
        timestamp: "2026-08-04T12:01:00.000Z",
    });

    assert.equal(value.steps[0].usage.totalTokens, 100);
    assert.equal(value.steps[0].updatedAt, "2026-08-04T12:01:00.000Z");
});

test("loads version 1 state without usage fields", () => {
    const normalized = normalizeState(
        {
            version: 1,
            view: "timeline",
            nextSequence: 2,
            steps: [
                {
                    id: "goal-1",
                    kind: "goal",
                    title: "Existing goal",
                    description: "Created before usage tracking.",
                    status: "success",
                    source: "automatic",
                    category: null,
                    dependencies: [],
                    toolNames: [],
                    activityCount: 0,
                    createdAt: START,
                    updatedAt: START,
                },
            ],
        },
        {
            sessionId: "session-1",
            documentId: "session-1",
            timestamp: START,
        },
    );

    assert.equal(normalized.usage, undefined);
    assert.equal(normalized.steps[0].usage, undefined);
    assert.equal(normalized.steps[0].title, "Existing goal");
    assert.deepEqual(normalized.chatEvents, []);
});
