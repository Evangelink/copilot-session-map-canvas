import {
    createState,
    recordChatEvent,
    recordSemanticStep,
    recordUsage,
    setPreferredView,
} from "../../state.mjs";
import { startCanvasServer } from "../../server.mjs";

const DOCUMENT_ID = "playwright-document";
const START = "2026-08-04T12:00:00.000Z";

function copy(value) {
    return structuredClone(value);
}

export function emptyState() {
    return createState({
        documentId: DOCUMENT_ID,
        sessionId: "playwright-session",
        timestamp: START,
    });
}

export function stateWithSteps() {
    const state = emptyState();
    recordSemanticStep(
        state,
        {
            id: "research",
            title: "Mapped the canvas architecture",
            description: "Identified the renderer and server boundaries.",
            status: "success",
        },
        { timestamp: "2026-08-04T12:01:00.000Z" },
    );
    recordChatEvent(state, {
        id: "event-research",
        type: "assistant",
        stepId: "research",
        title: "Copilot",
        content: "I mapped the renderer and server boundaries.",
        messageId: "message-research",
        turnId: "turn-1",
        timestamp: "2026-08-04T12:01:30.000Z",
    });
    recordUsage(state, {
        inputTokens: 100,
        outputTokens: 25,
        totalNanoAiu: 1_250_000_000,
        timestamp: "2026-08-04T12:01:45.000Z",
    });
    recordSemanticStep(
        state,
        {
            id: "implementation",
            title: "Implementing browser coverage",
            description: "Exercising timeline and dependency graph behavior.",
            status: "in_progress",
            dependsOn: ["research"],
        },
        { timestamp: "2026-08-04T12:02:00.000Z" },
    );
    recordChatEvent(state, {
        id: "event-implementation",
        type: "tool",
        stepId: "implementation",
        title: "apply_patch",
        content: "apply_patch started.",
        status: "in_progress",
        toolCallId: "tool-implementation",
        turnId: "turn-2",
        timestamp: "2026-08-04T12:02:30.000Z",
    });
    recordUsage(state, {
        inputTokens: 200,
        outputTokens: 50,
        totalNanoAiu: 2_500_000_000,
        timestamp: "2026-08-04T12:02:45.000Z",
    });
    return state;
}

export async function startTestCanvas(initialState = emptyState()) {
    let state = copy(initialState);
    const subscribers = new Set();
    let closed = false;

    const publish = () => {
        const snapshot = copy(state);
        for (const subscriber of subscribers) {
            subscriber(snapshot);
        }
    };

    const store = {
        subscribe(_documentId, subscriber) {
            subscribers.add(subscriber);
            return () => subscribers.delete(subscriber);
        },
    };

    const actions = {
        async getState() {
            return copy(state);
        },
        async refreshState() {
            publish();
            return copy(state);
        },
        async setView(_documentId, input) {
            setPreferredView(state, input.view);
            publish();
            return copy(state);
        },
        async recordStep(_documentId, input) {
            recordSemanticStep(state, input, {
                source: "canvas",
                timestamp: "2026-08-04T12:03:00.000Z",
            });
            publish();
            return copy(state);
        },
    };

    const server = await startCanvasServer({
        documentId: DOCUMENT_ID,
        instanceId: "playwright-instance",
        store,
        actions,
    });

    return {
        url: server.url,
        state: () => copy(state),
        recordStep(input, timestamp = "2026-08-04T12:04:00.000Z") {
            recordSemanticStep(state, input, {
                source: "agent",
                timestamp,
            });
            publish();
        },
        async close() {
            if (closed) {
                return;
            }
            closed = true;
            await server.close();
        },
    };
}
