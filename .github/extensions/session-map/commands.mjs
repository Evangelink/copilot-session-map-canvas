const MAP_CANVAS_ID = "session-map";
const MAP_COMMAND_INSTANCE_ID = "session-map-command";
const MAP_EXTENSION_INFO = {
    source: "session-map",
    name: "session-map",
};
const MAP_EXTENSION_ID =
    `${MAP_EXTENSION_INFO.source}:${MAP_EXTENSION_INFO.name}`;

export function createMapCommand({ listOpenCanvases, openCanvas }) {
    return {
        name: "map",
        description: "Open or focus the Session Map.",
        handler: async () => {
            const { openCanvases } = await listOpenCanvases();
            const existing = openCanvases.find(
                (candidate) =>
                    candidate.extensionId === MAP_EXTENSION_ID &&
                    candidate.canvasId === MAP_CANVAS_ID,
            );

            await openCanvas({
                extensionId: MAP_EXTENSION_ID,
                canvasId: MAP_CANVAS_ID,
                instanceId: existing?.instanceId ?? MAP_COMMAND_INSTANCE_ID,
            });
        },
    };
}

export { MAP_CANVAS_ID, MAP_EXTENSION_INFO };
