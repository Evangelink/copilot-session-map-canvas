import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { join } from "node:path";

import { createState, normalizeState } from "./state.mjs";

export class WorkspaceUnavailableError extends Error {}

function storageKey(documentId) {
    return createHash("sha256").update(documentId).digest("hex").slice(0, 24);
}

async function cleanupAndThrow(fileSystem, temporaryPath, error) {
    try {
        await fileSystem.rm(temporaryPath, { force: true });
    } catch (cleanupError) {
        throw new AggregateError(
            [error, cleanupError],
            "State replacement failed and its temporary file could not be removed.",
        );
    }
    throw error;
}

async function replaceFile(fileSystem, temporaryPath, destinationPath) {
    try {
        await fileSystem.rename(temporaryPath, destinationPath);
        return;
    } catch (error) {
        if (error.code !== "EEXIST" && error.code !== "EPERM") {
            await cleanupAndThrow(fileSystem, temporaryPath, error);
        }
    }

    const backupPath = `${destinationPath}.${process.pid}.${randomUUID()}.bak`;
    try {
        await fileSystem.rename(destinationPath, backupPath);
    } catch (error) {
        await cleanupAndThrow(fileSystem, temporaryPath, error);
    }

    try {
        await fileSystem.rename(temporaryPath, destinationPath);
    } catch (replacementError) {
        try {
            await fileSystem.rename(backupPath, destinationPath);
        } catch (restoreError) {
            throw new AggregateError(
                [replacementError, restoreError],
                `State replacement and restoration failed. The previous state remains at "${backupPath}".`,
            );
        }
        await cleanupAndThrow(fileSystem, temporaryPath, replacementError);
    }

    await fileSystem.rm(backupPath, { force: true });
}

export class StateStore {
    constructor({ workspacePath, sessionId, fileSystem = fs }) {
        this.workspacePath = workspacePath;
        this.sessionId = sessionId;
        this.fileSystem = fileSystem;
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
            const content = await this.fileSystem.readFile(
                this.pathFor(documentId),
                "utf8",
            );
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
        await this.fileSystem.mkdir(this.rootPath, { recursive: true });
        const path = this.pathFor(documentId);
        const temporaryPath = `${path}.${process.pid}.tmp`;
        await this.fileSystem.writeFile(
            temporaryPath,
            `${JSON.stringify(state, null, 2)}\n`,
            "utf8",
        );
        await replaceFile(this.fileSystem, temporaryPath, path);
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
