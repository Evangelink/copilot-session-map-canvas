export const MAP_CANVAS_INPUT_SCHEMA = {
    type: "object",
    additionalProperties: false,
    properties: {
        view: {
            type: "string",
            enum: ["timeline", "graph"],
            description: "Initial view to show.",
        },
    },
};

export const EMPTY_INPUT_SCHEMA = {
    type: "object",
    additionalProperties: false,
};

export const SET_VIEW_SCHEMA = {
    type: "object",
    additionalProperties: false,
    required: ["view"],
    properties: {
        view: {
            type: "string",
            enum: ["timeline", "graph"],
        },
    },
};

export const RECORD_STEP_SCHEMA = {
    type: "object",
    additionalProperties: false,
    required: ["title"],
    properties: {
        id: {
            type: "string",
            minLength: 1,
            maxLength: 80,
            pattern: "^[A-Za-z0-9][A-Za-z0-9._-]*$",
            description:
                "Stable step id. Reuse it to update an in-progress milestone.",
        },
        title: {
            type: "string",
            minLength: 1,
            maxLength: 120,
        },
        description: {
            type: "string",
            maxLength: 1000,
        },
        status: {
            type: "string",
            enum: ["in_progress", "success", "failure", "skipped"],
            default: "success",
        },
        dependsOn: {
            type: "array",
            maxItems: 20,
            uniqueItems: true,
            items: {
                type: "string",
                minLength: 1,
                maxLength: 80,
                pattern: "^[A-Za-z0-9][A-Za-z0-9._-]*$",
            },
        },
    },
};

export const RECORD_CHECK_SCHEMA = {
    type: "object",
    additionalProperties: false,
    required: ["kind"],
    properties: {
        kind: {
            type: "string",
            enum: ["build", "tests", "lint", "review"],
            description: "The verification activity being recorded.",
        },
        status: {
            type: "string",
            enum: ["passed", "failed", "unknown"],
            default: "unknown",
            description:
                "Use unknown when the activity ran but its outcome was not verified.",
        },
        summary: {
            type: "string",
            maxLength: 240,
            description:
                "A concise, privacy-safe outcome without command text or output.",
        },
    },
};
