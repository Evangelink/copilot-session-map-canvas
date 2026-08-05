import {
    CanvasError,
    createCanvas,
    joinSession,
} from "@github/copilot-sdk/extension";

import {
    createMapCommand,
    MAP_CANVAS_ID,
    MAP_EXTENSION_INFO,
} from "./commands.mjs";
import {
    completeToolChatEvent,
    completeSession,
    recordChatEvent,
    recordSemanticStep,
    recordSessionStart,
    recordToolActivity,
    recordTurnStart,
    recordUsage,
    recordUserGoal,
    setPreferredView,
} from "./state.mjs";
import {
    EMPTY_INPUT_SCHEMA,
    MAP_CANVAS_INPUT_SCHEMA,
    RECORD_STEP_SCHEMA,
    SET_VIEW_SCHEMA,
} from "./schemas.mjs";
import {
    StateStore,
    WorkspaceUnavailableError,
} from "./store.mjs";
import { startCanvasServer } from "./server.mjs";

const STEP_INSTRUCTION =
    "Session Map is active. After completing a meaningful high-level phase, call " +
    "`session_map_record_step` once with a concise title, outcome, and status. " +
    "Do not call it for individual tool invocations. Reuse the returned step id to update an in-progress milestone.";

const servers = new Map();

let session;
let store;

function timestampOf(input) {
    const timestamp = input?.timestamp;
    return timestamp instanceof Date
        ? timestamp.toISOString()
        : new Date(timestamp ?? Date.now()).toISOString();
}

function requireStore() {
    if (!store?.available) {
        throw new WorkspaceUnavailableError(
            "Session Map requires session.workspacePath, but this session did not provide one.",
        );
    }
    return store;
}

function documentIdForInstance(instanceId) {
    return servers.get(instanceId)?.documentId ?? session.sessionId;
}

async function getState(documentId) {
    return requireStore().read(documentId);
}

async function updateView(documentId, input) {
    return requireStore().mutate(documentId, (state) =>
        setPreferredView(state, input.view),
    );
}

async function addStep(documentId, input, source = "canvas") {
    return requireStore().mutate(documentId, (state) =>
        recordSemanticStep(state, input, {
            source,
            timestamp: new Date().toISOString(),
        }),
    );
}

async function refreshState(documentId) {
    const state = await getState(documentId);
    requireStore().publish(documentId, state);
    return state;
}

function asCanvasError(error) {
    if (error instanceof CanvasError) {
        return error;
    }
    if (error instanceof WorkspaceUnavailableError) {
        return new CanvasError("workspace_unavailable", error.message);
    }
    return new CanvasError("session_map_error", error.message);
}

async function forCanvasAction(ctx, operation) {
    try {
        return await operation(documentIdForInstance(ctx.instanceId));
    } catch (error) {
        throw asCanvasError(error);
    }
}

const canvas = createCanvas({
    id: MAP_CANVAS_ID,
    displayName: "Session Map",
    description:
        "Shows meaningful goals, work phases, outcomes, and dependencies for the current Copilot session.",
    inputSchema: MAP_CANVAS_INPUT_SCHEMA,
    actions: [
        {
            name: "get_state",
            description: "Return the latest persisted Session Map state.",
            inputSchema: EMPTY_INPUT_SCHEMA,
            handler: (ctx) =>
                forCanvasAction(ctx, (documentId) => getState(documentId)),
        },
        {
            name: "refresh",
            description:
                "Reload persisted state and notify the open canvas immediately.",
            inputSchema: EMPTY_INPUT_SCHEMA,
            handler: (ctx) =>
                forCanvasAction(ctx, (documentId) => refreshState(documentId)),
        },
        {
            name: "set_view",
            description: "Switch the persisted canvas view.",
            inputSchema: SET_VIEW_SCHEMA,
            handler: (ctx) =>
                forCanvasAction(ctx, (documentId) =>
                    updateView(documentId, ctx.input),
                ),
        },
        {
            name: "record_step",
            description:
                "Record or update a meaningful high-level session milestone.",
            inputSchema: RECORD_STEP_SCHEMA,
            handler: (ctx) =>
                forCanvasAction(ctx, (documentId) =>
                    addStep(documentId, ctx.input),
                ),
        },
    ],
    open: async (ctx) => {
        try {
            const activeStore = requireStore();
            const documentId = session.sessionId;
            if (ctx.input?.view) {
                await updateView(documentId, { view: ctx.input.view });
            } else {
                await activeStore.ensure(documentId);
            }

            let entry = servers.get(ctx.instanceId);

            if (entry && entry.documentId !== documentId) {
                servers.delete(ctx.instanceId);
                await entry.close();
                entry = undefined;
            }

            if (!entry) {
                entry = await startCanvasServer({
                    documentId,
                    instanceId: ctx.instanceId,
                    store: activeStore,
                    actions: {
                        getState,
                        refreshState,
                        setView: updateView,
                        recordStep: (id, input) => addStep(id, input, "canvas"),
                    },
                });
                servers.set(ctx.instanceId, entry);
            }

            return {
                title: "Session Map",
                status: "Live",
                url: entry.url,
            };
        } catch (error) {
            throw asCanvasError(error);
        }
    },
    onClose: async (ctx) => {
        const entry = servers.get(ctx.instanceId);
        if (!entry) {
            return;
        }
        servers.delete(ctx.instanceId);
        await entry.close();
    },
});

session = await joinSession({
    extensionInfo: MAP_EXTENSION_INFO,
    commands: [
        createMapCommand({
            listOpenCanvases: () => session.rpc.canvas.listOpen(),
            openCanvas: (input) => session.rpc.canvas.open(input),
        }),
    ],
    canvases: [canvas],
    tools: [
        {
            name: "session_map_record_step",
            description:
                "Records or updates one meaningful high-level phase in the current session map. Call after a phase, not after each tool.",
            parameters: RECORD_STEP_SCHEMA,
            handler: async (args, invocation) => {
                try {
                    const state = await addStep(
                        invocation.sessionId,
                        args,
                        "agent",
                    );
                    const step = state.steps.find(
                        (candidate) =>
                            candidate.id === args.id ||
                            candidate.id === state.lastRecordedStepId,
                    );
                    return {
                        resultType: "success",
                        textResultForLlm: JSON.stringify({
                            recorded: true,
                            stepId: step?.id,
                            status: step?.status,
                        }),
                    };
                } catch (error) {
                    return {
                        resultType: "failure",
                        textResultForLlm: error.message,
                        error: error.message,
                    };
                }
            },
        },
    ],
    hooks: {
        onSessionStart: async (input, invocation) => {
            if (!store?.available) {
                return {
                    additionalContext:
                        "Session Map could not start because session.workspacePath is unavailable.",
                };
            }
            await store.mutate(invocation.sessionId, (state) =>
                recordSessionStart(state, {
                    source: input.source,
                    initialPrompt: input.initialPrompt,
                    timestamp: timestampOf(input),
                }),
            );
            return { additionalContext: STEP_INSTRUCTION };
        },
        onUserPromptSubmitted: async (input, invocation) => {
            if (store?.available) {
                await store.mutate(invocation.sessionId, (state) =>
                    recordUserGoal(state, input.prompt, timestampOf(input)),
                );
            }
            return { additionalContext: STEP_INSTRUCTION };
        },
        onSessionEnd: async (input, invocation) => {
            if (store?.available) {
                await store.mutate(invocation.sessionId, (state) =>
                    completeSession(state, {
                        reason: input.reason,
                        timestamp: timestampOf(input),
                    }),
                );
            }
        },
    },
});

store = new StateStore({
    workspacePath: session.workspacePath,
    sessionId: session.sessionId,
});

function mutateFromEvent(event, mutator) {
    if (!store.available || event.agentId) {
        return;
    }
    void store
        .mutate(session.sessionId, mutator)
        .catch((error) =>
            session.log(`Session Map could not correlate chat activity: ${error.message}`, {
                level: "warning",
            }),
        );
}

function isHumanUserMessage(event) {
    const source = event.data.source;
    return (
        !event.data.isAutopilotContinuation &&
        (!source || source === "user" || source === "human")
    );
}

session.on("user.message", (event) => {
    if (!isHumanUserMessage(event)) {
        return;
    }
    mutateFromEvent(event, (state) =>
        recordChatEvent(state, {
            id: event.id,
            type: "user",
            title: "You",
            content: event.data.content,
            timestamp: event.timestamp,
        }),
    );
});

session.on("assistant.turn_start", (event) => {
    mutateFromEvent(event, (state) =>
        recordTurnStart(state, {
            turnId: event.data.turnId,
            timestamp: event.timestamp,
        }),
    );
});

session.on("assistant.message", (event) => {
    if (!event.data.content) {
        return;
    }
    mutateFromEvent(event, (state) =>
        recordChatEvent(state, {
            id: event.id,
            type: "assistant",
            title: "Copilot",
            content: event.data.content,
            messageId: event.data.messageId,
            turnId: event.data.turnId,
            timestamp: event.timestamp,
        }),
    );
});

session.on("tool.execution_start", (event) => {
    if (event.data.toolName === "session_map_record_step") {
        return;
    }
    mutateFromEvent(event, (state) => {
        recordToolActivity(state, {
            toolName: event.data.toolName,
            toolArgs: event.data.arguments,
            status: "success",
            timestamp: event.timestamp,
        });
        return recordChatEvent(state, {
            id: event.id,
            type: "tool",
            stepId: state.lastRecordedStepId,
            title: event.data.toolName,
            content: `${event.data.toolName} started.`,
            status: "in_progress",
            toolCallId: event.data.toolCallId,
            turnId: event.data.turnId,
            timestamp: event.timestamp,
        });
    });
});

session.on("tool.execution_complete", (event) => {
    mutateFromEvent(event, (state) =>
        completeToolChatEvent(state, {
            id: event.id,
            toolCallId: event.data.toolCallId,
            success: event.data.success,
            timestamp: event.timestamp,
        }),
    );
});

session.on("assistant.usage", (event) => {
    if (!store.available) {
        return;
    }
    void store
        .mutate(session.sessionId, (state) =>
            recordUsage(state, {
                inputTokens: event.data.inputTokens,
                outputTokens: event.data.outputTokens,
                cacheReadTokens: event.data.cacheReadTokens,
                cacheWriteTokens: event.data.cacheWriteTokens,
                totalNanoAiu: event.data.copilotUsage?.totalNanoAiu,
                timestamp: event.timestamp,
            }),
        )
        .catch((error) =>
            session.log(`Session Map could not record usage: ${error.message}`, {
                level: "warning",
            }),
        );
});
