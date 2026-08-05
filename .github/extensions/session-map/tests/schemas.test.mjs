import assert from "node:assert/strict";
import test from "node:test";

import { MAP_CANVAS_INPUT_SCHEMA } from "../schemas.mjs";

test("canvas input cannot select a document outside the current session", () => {
    assert.equal(MAP_CANVAS_INPUT_SCHEMA.additionalProperties, false);
    assert.deepEqual(Object.keys(MAP_CANVAS_INPUT_SCHEMA.properties), ["view"]);
    assert.equal(
        Object.hasOwn(MAP_CANVAS_INPUT_SCHEMA.properties, "documentId"),
        false,
    );
});
