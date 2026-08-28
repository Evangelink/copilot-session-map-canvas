import assert from "node:assert/strict";
import test from "node:test";

import {
    MAP_CANVAS_INPUT_SCHEMA,
    RECORD_CHECK_SCHEMA,
} from "../schemas.mjs";

test("canvas input cannot select a document outside the current session", () => {
    assert.equal(MAP_CANVAS_INPUT_SCHEMA.additionalProperties, false);
    assert.deepEqual(Object.keys(MAP_CANVAS_INPUT_SCHEMA.properties), ["view"]);
    assert.equal(
        Object.hasOwn(MAP_CANVAS_INPUT_SCHEMA.properties, "documentId"),
        false,
    );
});

test("explicit check schema limits evidence to supported values", () => {
    assert.deepEqual(RECORD_CHECK_SCHEMA.required, ["kind"]);
    assert.deepEqual(RECORD_CHECK_SCHEMA.properties.kind.enum, [
        "build",
        "tests",
        "lint",
        "review",
    ]);
    assert.deepEqual(RECORD_CHECK_SCHEMA.properties.status.enum, [
        "passed",
        "failed",
        "unknown",
    ]);
    assert.equal(RECORD_CHECK_SCHEMA.properties.status.default, "unknown");
});
