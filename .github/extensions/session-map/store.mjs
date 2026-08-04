import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { join } from "node:path";

import { createState, normalizeState } from "./state.mjs";

export class WorkspaceUnavailableError extends Error {}

function storageKey(documentId) {
    return createHash("sha256").update(documentId).digest("hex").slice(0, 24);
}

export class StateStore {
    constructor({ workspacePath, sessionId }) {
        this.workspacePath = workspacePath;
        this.sessionId = sessionId;
        this.rootPath = workspacePath
            ? join(workspacePath, ".copilot", "session-map")
            : null;
        this.queues = new Map();
        this.subscribers = new Map();
    }

    get available() {
        return Boolean(this.rootPath);
    }

    assertAvailable() {
        if (!this.available) {
            throw new WorkspaceUnavailableError(
                "Session Map cannot persist state because session.workspacePath is unavailable.",
            );
        }
    }

    pathFor(documentId) {
        this.assertAvailable();
        return join(this.rootPath, `${storageKey(documentId)}.json`);
    }

    async load(documentId) {
        this.assertAvailable();
        const defaults = {
            documentId,
            sessionId: this.sessionId,
        };
        try {
            const content = await fs.readFile(this.pathFor(documentId), "utf8");
            return normalizeState(JSON.parse(content), defaults);
        } catch (error) {
            if (error.code === "ENOENT") {
                return createState(defaults);
            }
            if (error instanceof SyntaxError) {
                throw new Error(
                    `Session Map state for "${documentId}" is not valid JSON.`,
                );
            }
            throw error;
        }
    }

    async read(documentId) {
        const pending = this.queues.get(documentId);
        if (pending) {
            await pending.catch(() => undefined);
        }
        return this.load(documentId);
    }

    async save(documentId, state) {
        this.assertAvailable();
        await fs.mkdir(this.rootPath, { recursive: true });
        const path = this.pathFor(documentId);
        const temporaryPath = `${path}.${process.pid}.tmp`;
        await fs.writeFile(
            temporaryPath,
            `${JSON.stringify(state, null, 2)}\n`,
            "utf8",
        );
        try {
            await fs.rename(temporaryPath, path);
        } catch (error) {
            if (error.code !== "EEXIST" && error.code !== "EPERM") {
                throw error;
            }
            await fs.rm(path, { force: true });
            await fs.rename(temporaryPath, path);
        }
    }

    async ensure(documentId) {
        return this.mutate(documentId, (state) => state);
    }

    async mutate(documentId, mutator) {
        this.assertAvailable();
        const previous = this.queues.get(documentId) ?? Promise.resolve();
        const operation = previous
            .catch(() => undefined)
            .then(async () => {
                const state = await this.load(documentId);
                const nextState = (await mutator(state)) ?? state;
                await this.save(documentId, nextState);
                this.publish(documentId, nextState);
                return nextState;
            });
        const tracked = operation.finally(() => {
            if (this.queues.get(documentId) === tracked) {
                this.queues.delete(documentId);
            }
        });
        this.queues.set(documentId, tracked);
        return tracked;
    }

    subscribe(documentId, listener) {
        const listeners = this.subscribers.get(documentId) ?? new Set();
        listeners.add(listener);
        this.subscribers.set(documentId, listeners);
        return () => {
            listeners.delete(listener);
            if (listeners.size === 0) {
                this.subscribers.delete(documentId);
            }
        };
    }

    publish(documentId, state) {
        for (const listener of this.subscribers.get(documentId) ?? []) {
            listener(state);
        }
    }
}
