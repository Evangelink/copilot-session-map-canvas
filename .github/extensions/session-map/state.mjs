const VALID_STATUSES = new Set([
    "in_progress",
    "success",
    "failure",
    "skipped",
]);
const VALID_VIEWS = new Set(["timeline", "graph"]);

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

function isoTimestamp(value = new Date().toISOString()) {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        throw new StateValidationError("A valid timestamp is required.");
    }
    return parsed.toISOString();
}

function allocateId(state, prefix) {
    const id = `${prefix}-${state.nextSequence}`;
    state.nextSequence += 1;
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
        steps: [],
    };
}

export function normalizeState(raw, defaults) {
    const base = createState(defaults);
    if (!raw || raw.version !== 1 || !Array.isArray(raw.steps)) {
        return base;
    }
    return {
        ...base,
        ...raw,
        documentId: defaults.documentId,
        sessionId: defaults.sessionId,
        view: VALID_VIEWS.has(raw.view) ? raw.view : "timeline",
        nextSequence:
            Number.isSafeInteger(raw.nextSequence) && raw.nextSequence > 0
                ? raw.nextSequence
                : raw.steps.length + 1,
        steps: raw.steps.filter(
            (step) =>
                step &&
                typeof step.id === "string" &&
                typeof step.title === "string" &&
                VALID_STATUSES.has(step.status),
        ),
    };
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
        /(apply_patch|edit|create_file|write_file|rename|format)/.test(name)
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
