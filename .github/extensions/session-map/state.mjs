const VALID_STATUSES = new Set([
    "in_progress",
    "success",
    "failure",
    "skipped",
]);
const VALID_VIEWS = new Set(["timeline", "graph"]);
const VALID_CHECK_KINDS = new Set(["build", "tests", "lint", "review"]);
const VALID_CHECK_STATUSES = new Set([
    "running",
    "passed",
    "failed",
    "unknown",
    "stale",
]);
const VALID_CHECK_SOURCES = new Set(["automatic", "agent", "canvas"]);
const CHECK_LABELS = {
    build: "Build",
    tests: "Tests",
    lint: "Lint",
    review: "Review",
};
const TOKEN_FIELDS = [
    "inputTokens",
    "outputTokens",
    "cacheReadTokens",
    "cacheWriteTokens",
];
const CHAT_EVENT_LIMIT = 400;
const CHAT_EVENT_TYPES = new Set(["user", "assistant", "tool"]);

const PHASES = {
    discovery: {
        title: "Exploring the problem",
        description: "Inspecting context and gathering the information needed to proceed.",
    },
    implementation: {
        title: "Implementing changes",
        description: "Creating and updating the project implementation.",
    },
    validation: {
        title: "Validating behavior",
        description: "Checking that the implementation works as intended.",
    },
    publication: {
        title: "Publishing the result",
        description: "Preparing and publishing the completed work.",
    },
    coordination: {
        title: "Coordinating work",
        description: "Managing related tasks and session workflow.",
    },
    operation: {
        title: "Running project operations",
        description: "Executing supporting project commands and operations.",
    },
};

export class StateValidationError extends Error {}

function cleanText(value, maximum) {
    if (value === undefined || value === null) {
        return "";
    }
    return String(value).replace(/\s+/g, " ").trim().slice(0, maximum);
}

function cleanIdentifier(value, maximum = 160) {
    return cleanText(value, maximum);
}

function isoTimestamp(value = new Date().toISOString()) {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        throw new StateValidationError("A valid timestamp is required.");
    }
    return parsed.toISOString();
}

function allocateId(state, prefix) {
    let id;
    do {
        id = `${prefix}-${state.nextSequence}`;
        state.nextSequence += 1;
    } while (state.steps.some((step) => step.id === id));
    return id;
}

function mostRecentStep(state, excludedId) {
    return [...state.steps]
        .reverse()
        .find((step) => step.id !== excludedId && step.kind !== "completion");
}

function finishActivePhase(state, timestamp) {
    if (!state.activePhaseId) {
        return;
    }
    const phase = state.steps.find((step) => step.id === state.activePhaseId);
    if (phase?.status === "in_progress") {
        phase.status = "success";
        phase.updatedAt = timestamp;
    }
    state.activePhaseId = null;
}

function dependenciesReach(state, startId, targetId, visited = new Set()) {
    if (startId === targetId) {
        return true;
    }
    if (visited.has(startId)) {
        return false;
    }
    visited.add(startId);
    const step = state.steps.find((candidate) => candidate.id === startId);
    return (step?.dependencies ?? []).some((dependency) =>
        dependenciesReach(state, dependency, targetId, visited),
    );
}

function validateDependencies(state, stepId, dependencies) {
    for (const dependency of dependencies) {
        if (dependency === stepId) {
            throw new StateValidationError("A step cannot depend on itself.");
        }
        if (!state.steps.some((step) => step.id === dependency)) {
            throw new StateValidationError(
                `Dependency "${dependency}" does not exist.`,
            );
        }
        if (dependenciesReach(state, dependency, stepId)) {
            throw new StateValidationError(
                `Dependency "${dependency}" would create a cycle.`,
            );
        }
    }
}

function updateMetadata(state, timestamp) {
    state.updatedAt = timestamp;
    return state;
}

function activeStepId(state) {
    return state.activePhaseId ?? state.lastRecordedStepId;
}

function cleanTimestamp(value) {
    const cleaned = cleanText(value, 40);
    if (!cleaned) {
        return "";
    }
    const parsed = new Date(cleaned);
    return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

function normalizeCheck(check, kind) {
    if (
        !check ||
        typeof check !== "object" ||
        !VALID_CHECK_KINDS.has(kind) ||
        !VALID_CHECK_STATUSES.has(check.status)
    ) {
        return undefined;
    }
    return {
        kind,
        status: check.status,
        source: VALID_CHECK_SOURCES.has(check.source)
            ? check.source
            : "automatic",
        summary: cleanText(check.summary, 240),
        toolName: cleanText(check.toolName, 120),
        stepId: cleanIdentifier(check.stepId),
        runId: cleanIdentifier(check.runId),
        startedAt: cleanTimestamp(check.startedAt),
        completedAt: cleanTimestamp(check.completedAt),
        updatedAt: cleanTimestamp(check.updatedAt),
    };
}

function normalizePendingCheckRuns(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return {};
    }
    return Object.fromEntries(
        Object.entries(raw)
            .slice(-20)
            .flatMap(([runId, run]) => {
                if (!run || typeof run !== "object") {
                    return [];
                }
                const entries = Array.isArray(run.entries)
                    ? run.entries
                          .filter(
                              (entry) =>
                                  VALID_CHECK_KINDS.has(entry?.kind) &&
                                  ["passed", "unknown"].includes(
                                      entry.successStatus,
                                  ),
                          )
                          .map((entry) => ({
                              kind: entry.kind,
                              successStatus: entry.successStatus,
                              stale: entry.stale === true,
                          }))
                    : [];
                return entries.length
                    ? [
                          [
                              cleanIdentifier(runId),
                              {
                                  entries,
                                  toolName: cleanText(run.toolName, 120),
                                  startedAt: cleanTimestamp(run.startedAt),
                                  stepId: cleanIdentifier(run.stepId),
                              },
                          ],
                      ]
                    : [];
            }),
    );
}

function normalizePendingMutationRuns(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return {};
    }
    return Object.fromEntries(
        Object.entries(raw)
            .slice(-50)
            .flatMap(([runId, run]) => {
                const id = cleanIdentifier(runId);
                const startedAt = cleanTimestamp(run?.startedAt);
                return id && startedAt ? [[id, { startedAt }]] : [];
            }),
    );
}

function ensureChatAnchors(step) {
    step.chat ??= {
        eventIds: [],
        turnIds: [],
        messageIds: [],
    };
    return step.chat;
}

function appendUnique(values, value, limit = 100) {
    if (value && !values.includes(value) && values.length < limit) {
        values.push(value);
    }
}

function associateChatEvent(state, stepId, event) {
    const step = state.steps.find((candidate) => candidate.id === stepId);
    if (!step) {
        return;
    }
    const anchors = ensureChatAnchors(step);
    appendUnique(anchors.eventIds, event.id);
    appendUnique(anchors.turnIds, event.turnId);
    appendUnique(anchors.messageIds, event.messageId);
}

function removeChatEventReference(state, event) {
    const step = state.steps.find((candidate) => candidate.id === event.stepId);
    if (!step?.chat) {
        return;
    }
    step.chat.eventIds = step.chat.eventIds.filter((id) => id !== event.id);
}

function tokenCount(value) {
    return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function usageAmount(value) {
    return Number.isFinite(value) && value >= 0 ? value : undefined;
}

export function normalizeUsage(raw) {
    if (!raw || typeof raw !== "object") {
        return undefined;
    }
    const usage = {};
    for (const field of [...TOKEN_FIELDS, "totalTokens", "modelCalls"]) {
        const value = tokenCount(raw[field]);
        if (value !== undefined) {
            usage[field] = value;
        }
    }
    const totalNanoAiu = usageAmount(raw.totalNanoAiu);
    if (totalNanoAiu !== undefined) {
        usage.totalNanoAiu = totalNanoAiu;
    }
    return Object.keys(usage).length ? usage : undefined;
}

function accumulateUsage(current, input) {
    const values = Object.fromEntries(
        TOKEN_FIELDS.map((field) => [field, tokenCount(input[field])]),
    );
    const totalNanoAiu = usageAmount(input.totalNanoAiu);
    if (
        TOKEN_FIELDS.every((field) => values[field] === undefined) &&
        totalNanoAiu === undefined
    ) {
        return undefined;
    }

    const previous = normalizeUsage(current) ?? {};
    const previousCalls = previous.modelCalls ?? 0;
    const next = {
        ...previous,
        modelCalls: previousCalls + 1,
    };
    for (const field of TOKEN_FIELDS) {
        if (values[field] !== undefined) {
            next[field] = (previous[field] ?? 0) + values[field];
        }
    }
    if (totalNanoAiu !== undefined) {
        next.totalNanoAiu = (previous.totalNanoAiu ?? 0) + totalNanoAiu;
    }

    const hasCompleteTotal =
        values.inputTokens !== undefined &&
        values.outputTokens !== undefined &&
        (previousCalls === 0 || previous.totalTokens !== undefined);
    if (hasCompleteTotal) {
        next.totalTokens =
            (previous.totalTokens ?? 0) +
            values.inputTokens +
            values.outputTokens;
    } else {
        delete next.totalTokens;
    }
    return next;
}

export function createState({
    sessionId,
    documentId = sessionId,
    timestamp = new Date().toISOString(),
}) {
    const createdAt = isoTimestamp(timestamp);
    return {
        version: 1,
        documentId,
        sessionId,
        createdAt,
        updatedAt: createdAt,
        startedAt: null,
        startSource: null,
        view: "timeline",
        nextSequence: 1,
        activePhaseId: null,
        lastRecordedStepId: null,
        completion: null,
        activeChatStepId: null,
        activeTurnId: null,
        chatEvents: [],
        checks: {},
        pendingCheckRuns: {},
        pendingMutationRuns: {},
        steps: [],
    };
}

export function normalizeState(raw, defaults) {
    const base = createState(defaults);
    if (!raw || raw.version !== 1 || !Array.isArray(raw.steps)) {
        return base;
    }
    const steps = raw.steps
        .filter(
            (step) =>
                step &&
                typeof step.id === "string" &&
                typeof step.title === "string" &&
                VALID_STATUSES.has(step.status),
        )
        .map((step) => {
            const normalized = {
                ...step,
                dependencies: Array.isArray(step.dependencies)
                    ? step.dependencies
                    : [],
                toolNames: Array.isArray(step.toolNames)
                    ? step.toolNames
                    : [],
                activityCount:
                    Number.isSafeInteger(step.activityCount) &&
                    step.activityCount >= 0
                        ? step.activityCount
                        : 0,
            };
            if (step.chat && typeof step.chat === "object") {
                normalized.chat = {
                    eventIds: Array.isArray(step.chat.eventIds)
                        ? step.chat.eventIds.filter((id) => typeof id === "string")
                        : [],
                    turnIds: Array.isArray(step.chat.turnIds)
                        ? step.chat.turnIds.filter((id) => typeof id === "string")
                        : [],
                    messageIds: Array.isArray(step.chat.messageIds)
                        ? step.chat.messageIds.filter(
                              (id) => typeof id === "string",
                          )
                        : [],
                };
            } else {
                delete normalized.chat;
            }
            const usage = normalizeUsage(step.usage);
            if (usage) {
                normalized.usage = usage;
            } else {
                delete normalized.usage;
            }
            return normalized;
        });
    const normalized = {
        ...base,
        ...raw,
        documentId: defaults.documentId,
        sessionId: defaults.sessionId,
        view: VALID_VIEWS.has(raw.view) ? raw.view : "timeline",
        nextSequence:
            Number.isSafeInteger(raw.nextSequence) && raw.nextSequence > 0
                ? raw.nextSequence
                : raw.steps.length + 1,
        steps,
        activeChatStepId:
            typeof raw.activeChatStepId === "string"
                ? raw.activeChatStepId
                : null,
        activeTurnId:
            typeof raw.activeTurnId === "string" ? raw.activeTurnId : null,
        chatEvents: Array.isArray(raw.chatEvents)
            ? raw.chatEvents
                  .filter(
                      (event) =>
                          event &&
                          typeof event.id === "string" &&
                          CHAT_EVENT_TYPES.has(event.type) &&
                          typeof event.timestamp === "string",
                  )
                  .slice(-CHAT_EVENT_LIMIT)
            : [],
        checks: Object.fromEntries(
            Object.entries(raw.checks ?? {}).flatMap(([kind, check]) => {
                const value = normalizeCheck(check, kind);
                return value ? [[kind, value]] : [];
            }),
        ),
        pendingCheckRuns: normalizePendingCheckRuns(raw.pendingCheckRuns),
        pendingMutationRuns: normalizePendingMutationRuns(
            raw.pendingMutationRuns,
        ),
    };
    const usage = normalizeUsage(raw.usage);
    if (usage) {
        normalized.usage = usage;
    } else {
        delete normalized.usage;
    }
    return normalized;
}

export function recordSessionStart(state, input) {
    const timestamp = isoTimestamp(input.timestamp);
    state.startedAt ??= timestamp;
    state.startSource ??= input.source;
    if (input.initialPrompt) {
        recordUserGoal(state, input.initialPrompt, timestamp);
    }
    return updateMetadata(state, timestamp);
}

export function recordUserGoal(state, prompt, value) {
    const timestamp = isoTimestamp(value);
    const description = cleanText(prompt, 600);
    if (!description) {
        return state;
    }
    const previous = state.steps.at(-1);
    if (previous?.kind === "goal" && previous.description === description) {
        return state;
    }

    finishActivePhase(state, timestamp);
    const firstSentence =
        description.match(/^.*?(?:[.!?](?:\s|$)|$)/)?.[0] ?? description;
    const title = cleanText(firstSentence, 100) || "New user goal";
    const dependency = mostRecentStep(state);
    const id = allocateId(state, "goal");
    state.steps.push({
        id,
        kind: "goal",
        title,
        description,
        status: "success",
        source: "automatic",
        category: null,
        dependencies: dependency ? [dependency.id] : [],
        toolNames: [],
        activityCount: 0,
        createdAt: timestamp,
        updatedAt: timestamp,
    });
    state.lastRecordedStepId = id;
    state.completion = null;
    return updateMetadata(state, timestamp);
}

export function classifyToolActivity(toolName, toolArgs = {}) {
    const name = cleanText(toolName, 160).toLowerCase();
    const command = cleanText(toolArgs?.command, 1000).toLowerCase();

    if (
        /(create_pull_request|update_pull_request|git.*(?:commit|push)|pr_review)/.test(
            name,
        ) ||
        /\bgit\s+(?:commit|push)\b|\bgh\s+pr\s+create\b/.test(command)
    ) {
        return "publication";
    }
    if (
        /(test|lint|build|compile|check|extensions_reload|open_canvas|invoke_canvas_action|list_canvas_capabilities)/.test(
            name,
        ) ||
        /\b(?:test|lint|build|compile|check)\b/.test(command)
    ) {
        return "validation";
    }
    if (
        /(?:^|[.:_-])(?:apply_patch|edit|create_file|write_file|update_file|delete_file|format_file)(?:$|[.:_-])/.test(
            name,
        )
    ) {
        return "implementation";
    }
    if (/(rg|glob|view|read|search|lsp|web_fetch|fetch)/.test(name)) {
        return "discovery";
    }
    if (/(task|agent|todo|sql|ask_user|send_session)/.test(name)) {
        return "coordination";
    }
    return "operation";
}

function detectCheckActivity(toolName, toolArgs = {}) {
    const name = cleanText(toolName, 160).toLowerCase();
    const command = cleanText(toolArgs?.command, 2000)
        .toLowerCase()
        .replace(/^&\s+/, "");
    const agentType = cleanText(
        toolArgs?.agent_type ?? toolArgs?.agentType,
        160,
    ).toLowerCase();
    const detected = new Map();
    const add = (kind, successStatus = "passed") =>
        detected.set(kind, { kind, successStatus });
    const isSingleCommand = !/[;&|\r\n]/.test(command);

    if (
        /(?:^|[.:_-])(?:node_test|pytest|run-tests|code-testing-tester)(?:$|[.:_-])/.test(
            name,
        ) ||
        (isSingleCommand &&
            /^(?:node\s+--test|dotnet\s+test|go\s+test|cargo\s+test|pytest|python\s+-m\s+pytest)\b/.test(
                command,
            )) ||
        (isSingleCommand &&
            /^(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test(?::[\w.-]+)?\b/.test(
                command,
            ))
    ) {
        add("tests");
    }
    if (
        /(?:^|[.:_-])(?:dotnet_build|code-testing-builder)(?:$|[.:_-])/.test(
            name,
        ) ||
        (isSingleCommand &&
            /^(?:dotnet\s+build|msbuild|go\s+build|cargo\s+build)\b/.test(
                command,
            )) ||
        (isSingleCommand &&
            /^(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?build(?::[\w.-]+)?\b/.test(
                command,
            ))
    ) {
        add("build");
    }
    if (
        /(?:^|[.:_-])(?:eslint|code-testing-linter)(?:$|[.:_-])/.test(name) ||
        (isSingleCommand &&
            /^(?:eslint|node\s+--check|dotnet\s+format)\b/.test(command)) ||
        (isSingleCommand &&
            /^(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?lint(?::[\w.-]+)?\b/.test(
                command,
            ))
    ) {
        add("lint");
    }
    if (name === "task") {
        if (agentType === "code-review") {
            add("review", "unknown");
        } else if (/code-testing-tester$/.test(agentType)) {
            add("tests", "unknown");
        } else if (/code-testing-builder$/.test(agentType)) {
            add("build", "unknown");
        } else if (/code-testing-linter$/.test(agentType)) {
            add("lint", "unknown");
        }
    }
    return [...detected.values()];
}

export function classifyCheckActivity(toolName, toolArgs = {}) {
    return detectCheckActivity(toolName, toolArgs).map((entry) => entry.kind);
}

function isProjectMutationActivity(toolName, toolArgs = {}) {
    const name = cleanText(toolName, 160).toLowerCase();
    const command = cleanText(toolArgs?.command, 2000)
        .toLowerCase()
        .replace(/^&\s+/, "");
    const isDotnetFormatMutation =
        /^dotnet\s+format\b/.test(command) &&
        !/\s--verify-no-changes\b/.test(command);
    return (
        /(?:^|[.:_-])(?:apply_patch|edit|create_file|write_file|update_file|delete_file|format_file)(?:$|[.:_-])/.test(
            name,
        ) ||
        /^(?:set-content|add-content|out-file|move-item|rename-item|remove-item|copy-item|new-item|git\s+apply|git\s+restore|git\s+checkout\s+--|sed\s+-i|perl\s+-pi|prettier\s+--write)(?:\s|$)/.test(
            command,
        ) ||
        isDotnetFormatMutation ||
        /^eslint\b.*\s--fix(?:\s|$)/.test(command) ||
        /^(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?lint:fix\b/.test(command) ||
        /(?:^|\s)>{1,2}(?!&)/.test(command)
    );
}

export function recordMutationStart(state, input) {
    const timestamp = isoTimestamp(input.timestamp);
    const runId = cleanIdentifier(input.toolCallId);
    if (
        !runId ||
        !isProjectMutationActivity(input.toolName, input.toolArgs)
    ) {
        return state;
    }

    state.pendingMutationRuns ??= {};
    while (Object.keys(state.pendingMutationRuns).length >= 50) {
        delete state.pendingMutationRuns[
            Object.keys(state.pendingMutationRuns)[0]
        ];
    }
    state.pendingMutationRuns[runId] = { startedAt: timestamp };
    return updateMetadata(state, timestamp);
}

export function recordMutationCompletion(state, input) {
    const timestamp = isoTimestamp(input.timestamp);
    const runId = cleanIdentifier(input.toolCallId);
    if (!state.pendingMutationRuns?.[runId]) {
        return state;
    }

    delete state.pendingMutationRuns[runId];
    if (input.success) {
        markChecksStale(state, timestamp, runId);
    }
    return updateMetadata(state, timestamp);
}

export function recordCheckStart(state, input) {
    const timestamp = isoTimestamp(input.timestamp);
    const runId = cleanIdentifier(input.toolCallId);
    const toolName = cleanText(input.toolName, 120) || "unknown tool";
    const entries = detectCheckActivity(toolName, input.toolArgs);
    if (!runId || entries.length === 0) {
        return state;
    }

    state.checks ??= {};
    state.pendingCheckRuns ??= {};
    while (Object.keys(state.pendingCheckRuns).length >= 20) {
        const oldestRunId = Object.keys(state.pendingCheckRuns)[0];
        const oldestRun = state.pendingCheckRuns[oldestRunId];
        for (const entry of oldestRun.entries) {
            const check = state.checks[entry.kind];
            if (check?.runId === oldestRunId) {
                check.status = "unknown";
                check.summary = `${CHECK_LABELS[entry.kind]} completion was not observed.`;
                check.updatedAt = timestamp;
                delete check.runId;
            }
        }
        delete state.pendingCheckRuns[oldestRunId];
    }
    const stepId = activeStepId(state);
    state.pendingCheckRuns[runId] = {
        entries,
        toolName,
        startedAt: timestamp,
        stepId,
    };
    for (const { kind } of entries) {
        state.checks[kind] = {
            kind,
            status: "running",
            source: "automatic",
            summary: `${CHECK_LABELS[kind]} started.`,
            toolName,
            stepId,
            runId,
            startedAt: timestamp,
            completedAt: "",
            updatedAt: timestamp,
        };
    }
    return updateMetadata(state, timestamp);
}

export function recordCheckCompletion(state, input) {
    const timestamp = isoTimestamp(input.timestamp);
    const runId = cleanIdentifier(input.toolCallId);
    const pending = state.pendingCheckRuns?.[runId];
    if (!pending) {
        return state;
    }

    for (const entry of pending.entries) {
        const check = state.checks?.[entry.kind];
        if (check?.runId !== runId) {
            continue;
        }
        const status = entry.stale
            ? "stale"
            : input.success
              ? entry.successStatus
              : "failed";
        check.status = status;
        check.summary =
            status === "passed"
                ? `${entry.kind === "review" ? "Review completed" : `${CHECK_LABELS[entry.kind]} passed`}.`
                : status === "failed"
                  ? `${CHECK_LABELS[entry.kind]} failed.`
                  : status === "stale"
                    ? "Project changes were recorded while this check was running."
                    : `${CHECK_LABELS[entry.kind]} runner completed, but its outcome could not be verified.`;
        check.completedAt = timestamp;
        check.updatedAt = timestamp;
        delete check.runId;
    }
    delete state.pendingCheckRuns[runId];
    return updateMetadata(state, timestamp);
}

export function recordExplicitCheck(
    state,
    input,
    { source = "agent", timestamp = new Date().toISOString() } = {},
) {
    const updatedAt = isoTimestamp(timestamp);
    const kind = cleanText(input.kind, 40);
    const status = input.status ?? "unknown";
    if (!VALID_CHECK_KINDS.has(kind)) {
        throw new StateValidationError(`Unsupported check kind "${kind}".`);
    }
    if (!["passed", "failed", "unknown"].includes(status)) {
        throw new StateValidationError(`Unsupported check status "${status}".`);
    }

    state.checks ??= {};
    const previous = state.checks[kind];
    state.checks[kind] = {
        kind,
        status,
        source,
        summary:
            cleanText(input.summary, 240) ||
            `${kind === "review" ? "Review completed" : `${CHECK_LABELS[kind]} ${status}`}.`,
        toolName: "",
        stepId: activeStepId(state),
        startedAt: previous?.startedAt ?? updatedAt,
        completedAt: updatedAt,
        updatedAt,
    };
    return updateMetadata(state, updatedAt);
}

function markChecksStale(state, timestamp, excludedRunId) {
    for (const check of Object.values(state.checks ?? {})) {
        if (check.status === "stale" || check.runId === excludedRunId) {
            continue;
        }
        if (check.status === "running") {
            const pending = state.pendingCheckRuns?.[check.runId];
            const entry = pending?.entries.find(
                (candidate) => candidate.kind === check.kind,
            );
            if (entry) {
                entry.stale = true;
                check.summary =
                    "Project changes were recorded while this check was running.";
                check.updatedAt = timestamp;
            }
            continue;
        }
        check.status = "stale";
        check.summary = "Project changes were recorded after this check.";
        check.updatedAt = timestamp;
        delete check.runId;
    }
}

export function recordToolActivity(state, input) {
    const timestamp = isoTimestamp(input.timestamp);
    const toolName = cleanText(input.toolName, 120) || "unknown tool";
    const category = classifyToolActivity(toolName, input.toolArgs);
    let phase = state.steps.find(
        (step) =>
            step.id === state.activePhaseId &&
            step.category === category &&
            step.status === "in_progress",
    );

    if (!phase) {
        finishActivePhase(state, timestamp);
        const id = allocateId(state, "phase");
        const dependency = mostRecentStep(state);
        const phaseDefinition = PHASES[category];
        phase = {
            id,
            kind: "phase",
            title: phaseDefinition.title,
            description: phaseDefinition.description,
            status: "in_progress",
            source: "automatic",
            category,
            dependencies: dependency ? [dependency.id] : [],
            toolNames: [],
            activityCount: 0,
            createdAt: timestamp,
            updatedAt: timestamp,
        };
        state.steps.push(phase);
        state.activePhaseId = id;
    }

    phase.activityCount += 1;
    if (!phase.toolNames.includes(toolName) && phase.toolNames.length < 12) {
        phase.toolNames.push(toolName);
    }
    phase.description =
        input.status === "failure"
            ? `${toolName} failed during this phase.`
            : `${phase.activityCount} related tool ${phase.activityCount === 1 ? "operation" : "operations"} recorded.`;
    phase.updatedAt = timestamp;

    if (input.status === "failure") {
        phase.status = "failure";
        state.activePhaseId = null;
    }
    state.lastRecordedStepId = phase.id;
    return updateMetadata(state, timestamp);
}

export function recordUsage(state, input) {
    const timestamp = isoTimestamp(input.timestamp);
    const sessionUsage = accumulateUsage(state.usage, input);
    if (!sessionUsage) {
        return state;
    }

    state.usage = sessionUsage;
    const stepId = state.activePhaseId ?? state.lastRecordedStepId;
    const step = state.steps.find((candidate) => candidate.id === stepId);
    if (step) {
        step.usage = accumulateUsage(step.usage, input);
        step.updatedAt = timestamp;
    }
    return updateMetadata(state, timestamp);
}

export function recordTurnStart(state, input) {
    const timestamp = isoTimestamp(input.timestamp);
    state.activeTurnId = cleanIdentifier(input.turnId) || null;
    state.activeChatStepId = activeStepId(state) ?? null;
    return updateMetadata(state, timestamp);
}

export function recordChatEvent(state, input) {
    const timestamp = isoTimestamp(input.timestamp);
    const id = cleanIdentifier(input.id);
    const type = cleanIdentifier(input.type, 20);
    if (!id) {
        throw new StateValidationError("A chat event id is required.");
    }
    if (!CHAT_EVENT_TYPES.has(type)) {
        throw new StateValidationError(`Unsupported chat event type "${type}".`);
    }

    const requestedStepId = cleanIdentifier(input.stepId, 80);
    const stepId =
        (requestedStepId &&
        state.steps.some((step) => step.id === requestedStepId)
            ? requestedStepId
            : activeStepId(state)) ?? null;
    const event = {
        id,
        type,
        stepId,
        timestamp,
        turnId:
            cleanIdentifier(input.turnId) || state.activeTurnId || undefined,
        messageId: cleanIdentifier(input.messageId) || undefined,
        toolCallId: cleanIdentifier(input.toolCallId) || undefined,
        title: cleanText(input.title, 160),
        content: cleanText(input.content, 2000),
        status: cleanIdentifier(input.status, 40) || undefined,
    };

    state.chatEvents.push(event);
    if (state.chatEvents.length > CHAT_EVENT_LIMIT) {
        const removed = state.chatEvents.splice(
            0,
            state.chatEvents.length - CHAT_EVENT_LIMIT,
        );
        for (const oldEvent of removed) {
            removeChatEventReference(state, oldEvent);
        }
    }
    if (stepId) {
        associateChatEvent(state, stepId, event);
        state.activeChatStepId = stepId;
    }
    if (event.turnId) {
        state.activeTurnId = event.turnId;
    }
    return updateMetadata(state, timestamp);
}

export function completeToolChatEvent(state, input) {
    const timestamp = isoTimestamp(input.timestamp);
    const toolCallId = cleanIdentifier(input.toolCallId);
    const event = [...state.chatEvents]
        .reverse()
        .find(
            (candidate) =>
                candidate.type === "tool" &&
                candidate.toolCallId === toolCallId,
        );
    if (!event) {
        return state;
    }

    event.status = input.success ? "success" : "failure";
    event.content = input.success
        ? `${event.title} completed.`
        : `${event.title} failed.`;
    event.completedAt = timestamp;

    const step = state.steps.find((candidate) => candidate.id === event.stepId);
    if (step) {
        appendUnique(
            ensureChatAnchors(step).eventIds,
            cleanIdentifier(input.id),
        );
        step.updatedAt = timestamp;
        state.activeChatStepId = step.id;
        if (!input.success) {
            step.status = "failure";
            step.description = `${event.title} failed during this phase.`;
            if (state.activePhaseId === step.id) {
                state.activePhaseId = null;
            }
        }
    }
    return updateMetadata(state, timestamp);
}

export function recordSemanticStep(
    state,
    input,
    { source = "agent", timestamp = new Date().toISOString() } = {},
) {
    const updatedAt = isoTimestamp(timestamp);
    const title = cleanText(input.title, 120);
    const description = cleanText(input.description, 1000);
    const status = input.status ?? "success";
    if (!title) {
        throw new StateValidationError("Step title is required.");
    }
    if (!VALID_STATUSES.has(status)) {
        throw new StateValidationError(`Unsupported step status "${status}".`);
    }

    const requestedId = cleanText(input.id, 80);
    const existing = requestedId
        ? state.steps.find((step) => step.id === requestedId)
        : undefined;
    finishActivePhase(state, updatedAt);

    const id = existing?.id ?? (requestedId || allocateId(state, "step"));
    const dependencies = input.dependsOn
        ? [...new Set(input.dependsOn)]
        : existing?.dependencies ??
          (mostRecentStep(state, id)
              ? [mostRecentStep(state, id).id]
              : []);
    validateDependencies(state, id, dependencies);

    if (existing) {
        existing.title = title;
        existing.description = description;
        existing.status = status;
        existing.dependencies = dependencies;
        existing.updatedAt = updatedAt;
        existing.source = source;
    } else {
        state.steps.push({
            id,
            kind: "milestone",
            title,
            description,
            status,
            source,
            category: null,
            dependencies,
            toolNames: [],
            activityCount: 0,
            createdAt: updatedAt,
            updatedAt,
        });
    }

    state.lastRecordedStepId = id;
    state.completion = null;
    return updateMetadata(state, updatedAt);
}

export function setPreferredView(state, view) {
    if (!VALID_VIEWS.has(view)) {
        throw new StateValidationError(`Unsupported view "${view}".`);
    }
    state.view = view;
    return updateMetadata(state, new Date().toISOString());
}

export function completeSession(state, input) {
    const timestamp = isoTimestamp(input.timestamp);
    finishActivePhase(state, timestamp);
    for (const check of Object.values(state.checks ?? {})) {
        if (check.status !== "running") {
            continue;
        }
        const pending = state.pendingCheckRuns?.[check.runId];
        const entry = pending?.entries.find(
            (candidate) => candidate.kind === check.kind,
        );
        check.status = entry?.stale ? "stale" : "unknown";
        check.summary = entry?.stale
            ? "Project changes were recorded while this check was running."
            : `${CHECK_LABELS[check.kind]} completion was not observed.`;
        check.updatedAt = timestamp;
        delete check.runId;
    }
    state.pendingCheckRuns = {};
    state.pendingMutationRuns = {};
    const status =
        input.reason === "complete"
            ? "success"
            : input.reason === "user_exit"
              ? "skipped"
              : "failure";
    const title =
        status === "success"
            ? "Session completed"
            : status === "skipped"
              ? "Session ended"
              : "Session ended with a problem";
    const dependency = mostRecentStep(state, "completion");
    const existing = state.steps.find((step) => step.id === "completion");
    const completionStep = {
        id: "completion",
        kind: "completion",
        title,
        description: `Session ended with reason: ${input.reason}.`,
        status,
        source: "automatic",
        category: null,
        dependencies: dependency ? [dependency.id] : [],
        toolNames: [],
        activityCount: 0,
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp,
    };
    if (existing) {
        Object.assign(existing, completionStep);
    } else {
        state.steps.push(completionStep);
    }
    state.completion = {
        reason: input.reason,
        status,
        timestamp,
    };
    state.lastRecordedStepId = "completion";
    return updateMetadata(state, timestamp);
}
