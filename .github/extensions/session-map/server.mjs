import { createServer } from "node:http";

import { renderHtml } from "./renderer.mjs";

const MAX_BODY_BYTES = 64 * 1024;

function json(res, statusCode, value) {
    res.writeHead(statusCode, {
        "Cache-Control": "no-store",
        "Content-Type": "application/json; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
    });
    res.end(JSON.stringify(value));
}

async function readJson(req) {
    let body = "";
    for await (const chunk of req) {
        body += chunk;
        if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
            throw new Error("Request body is too large.");
        }
    }
    if (!body) {
        return {};
    }
    return JSON.parse(body);
}

function sendEvent(res, state) {
    res.write(`event: state\ndata: ${JSON.stringify(state)}\n\n`);
}

export async function startCanvasServer({
    documentId,
    instanceId,
    store,
    actions,
}) {
    const eventClients = new Set();
    const unsubscribe = store.subscribe(documentId, (state) => {
        for (const client of eventClients) {
            sendEvent(client, state);
        }
    });
    const keepAlive = setInterval(() => {
        for (const client of eventClients) {
            client.write(": keep-alive\n\n");
        }
    }, 20_000);
    keepAlive.unref();

    const server = createServer(async (req, res) => {
        try {
            const url = new URL(req.url, "http://127.0.0.1");
            if (req.method === "GET" && url.pathname === "/") {
                res.writeHead(200, {
                    "Cache-Control": "no-store",
                    "Content-Type": "text/html; charset=utf-8",
                    "Content-Security-Policy":
                        "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:",
                    "X-Content-Type-Options": "nosniff",
                });
                res.end(renderHtml({ documentId, instanceId }));
                return;
            }
            if (req.method === "GET" && url.pathname === "/state") {
                json(res, 200, await actions.getState(documentId));
                return;
            }
            if (req.method === "GET" && url.pathname === "/events") {
                res.writeHead(200, {
                    "Cache-Control": "no-cache, no-transform",
                    Connection: "keep-alive",
                    "Content-Type": "text/event-stream",
                    "X-Accel-Buffering": "no",
                });
                eventClients.add(res);
                sendEvent(res, await actions.getState(documentId));
                req.on("close", () => eventClients.delete(res));
                return;
            }
            if (req.method === "POST" && url.pathname === "/api/view") {
                json(
                    res,
                    200,
                    await actions.setView(documentId, await readJson(req)),
                );
                return;
            }
            if (req.method === "POST" && url.pathname === "/api/step") {
                json(
                    res,
                    200,
                    await actions.recordStep(documentId, await readJson(req)),
                );
                return;
            }
            if (req.method === "POST" && url.pathname === "/api/refresh") {
                await readJson(req);
                json(res, 200, await actions.refreshState(documentId));
                return;
            }
            json(res, 404, { error: "Not found." });
        } catch (error) {
            json(res, 400, { error: error.message });
        }
    });

    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;

    return {
        documentId,
        server,
        url: `http://127.0.0.1:${port}/`,
        async close() {
            unsubscribe();
            clearInterval(keepAlive);
            for (const client of eventClients) {
                client.end();
            }
            eventClients.clear();
            await new Promise((resolve) => server.close(resolve));
        },
    };
}
