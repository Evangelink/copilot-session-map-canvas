# Session Map

Session Map is a project-scoped GitHub Copilot canvas extension that turns the
current Copilot session into a concise visual history. It shows user goals,
aggregated work phases, explicit milestones, failures, and session completion
in either a chronological timeline or a dependency graph.

The extension runtime is dependency-free. It uses only Node.js built-ins and
the Copilot extension SDK supplied by the CLI. Playwright is used only for
development-time browser tests.

## Features

- **Timeline and graph views** over the same persisted session document
- **Automatic capture** of user goals, coarse tool-activity phases, failures,
  and session completion
- **Semantic milestones** that Copilot can create and update after meaningful
  work phases
- **Explicit dependencies** between milestones, with validation against
  missing references, self-dependencies, and cycles
- **Exact token usage** from supported SDK events, summarized per session and
  attributed to the active goal, phase, or milestone
- **Accessible step details** for descriptions, metadata, activity, timing, and
  token breakdowns
- **`/map` slash command** to open or focus the canvas immediately
- **Live updates** through Server-Sent Events while the canvas is open
- **Chat correlation** using stable session event, turn, message, and tool-call
  identifiers
- **Synchronized in-canvas navigation**: selecting a map step locates its chat
  activity, while selecting a transcript entry locates the related timeline or
  graph node
- **Local, project-scoped persistence** with no runtime package install or
  build step

## Demo

> Screenshot placeholder: open the **Session Map** canvas during an active
> Copilot session and capture both the Timeline and Graph views.

The **Timeline** view is best for reading progress in order: goals, phases,
milestones, failures, and completion appear with their status, timestamps, token
totals, and expandable details. The details include description, source,
category, dependencies, tool activity, duration when derivable, and the
available token breakdown.
The **Graph** view uses the same steps and their dependencies to show how one
piece of work leads to another while keeping token totals compact.

A useful demo flow is:

1. Open Session Map at the beginning of a task.
2. Ask Copilot to complete a phase and record its outcome.
3. Reuse the returned step id when that phase moves from `in_progress` to
   `success` or `failure`.
4. Switch to Graph view to inspect the resulting dependency chain.

## Installation

### Use this repository

1. Clone the repository and open the clone as your Copilot workspace.
2. Start a new Copilot session in that workspace.
3. Reload extensions if the session was already running when the repository
   was cloned or updated.
4. Confirm that the `/map` command, `session-map` canvas, and
   `session_map_record_step` tool are available.

The project extension lives at:

```text
.github/extensions/session-map/extension.mjs
```

Copilot discovers project extensions under `.github/extensions/`. No
`npm install`, package manifest, CDN, or separate build step is required. The
host resolves `@github/copilot-sdk` for the extension process.

### Add it to another project

Copy `.github/extensions/session-map/` into the same location in the target
repository, preserving the directory structure:

```text
your-project/
└── .github/
    └── extensions/
        └── session-map/
            ├── extension.mjs
            ├── commands.mjs
            ├── renderer.mjs
            ├── schemas.mjs
            ├── server.mjs
            ├── state.mjs
            └── store.mjs
```

Then start a session in `your-project` or reload extensions in an existing
session.

## Usage

### Open the canvas

Run:

```text
/map
```

The command opens Session Map directly and focuses an existing Session Map
instance, including one opened through Copilot. You can also ask Copilot:

> Open the Session Map canvas.

To choose the initial view explicitly:

> Open the `session-map` canvas in graph view.

The equivalent canvas input is:

```json
{
  "view": "graph"
}
```

Once open, use the **Timeline** and **Graph** controls in the canvas. The
selected view is persisted in the session document.

The **Chat activity** pane mirrors the user, assistant, and tool activity
captured while Session Map is active. Select a timeline card or graph node to
scroll to its first chat anchor. Select a transcript entry to highlight and
scroll to the corresponding map node. New activity automatically follows the
active step until you make an explicit selection.

This synchronization is intentionally contained within the canvas. Extension
iframes do not have a host navigation bridge, so Session Map cannot scroll the
Copilot application's main chat viewport or observe which main-chat message is
currently visible.

### Record a semantic step

The extension contributes the `session_map_record_step` tool. Copilot is
instructed to call it once after a meaningful high-level phase, not after every
tool invocation.

For example, ask Copilot:

> Record an in-progress Session Map step for implementing the renderer, using
> the id `renderer`.

This corresponds to:

```json
{
  "id": "renderer",
  "title": "Implementing the renderer",
  "description": "Building the timeline and graph presentation.",
  "status": "in_progress"
}
```

The tool returns the recorded `stepId`. Reuse that id to update the same
milestone rather than creating another node:

```json
{
  "id": "renderer",
  "title": "Implemented the renderer",
  "description": "Timeline and graph views are available.",
  "status": "success"
}
```

To connect a later step to existing work, provide `dependsOn`:

```json
{
  "id": "validation",
  "title": "Validated the extension",
  "description": "Unit and syntax checks completed.",
  "status": "success",
  "dependsOn": ["renderer"]
}
```

If `id` is omitted, Session Map allocates one. If `dependsOn` is omitted, a new
semantic step depends on the most recent non-completion step when one exists.

### Status and dependency semantics

| Status | Meaning |
| --- | --- |
| `in_progress` | Work has started and may be updated later using the same id. |
| `success` | The phase completed successfully. This is the default when status is omitted. |
| `failure` | The phase ended unsuccessfully. |
| `skipped` | The phase was intentionally not completed. |

Dependencies point from a step to the earlier steps it requires. Every id in
`dependsOn` must already exist. A step cannot depend on itself, and adding a
dependency that creates a cycle is rejected. Updating an existing step without
`dependsOn` preserves its current dependencies.

### Canvas actions

| Action | Purpose |
| --- | --- |
| `get_state` | Return the latest persisted document. |
| `refresh` | Reload persisted state and push it to open views. |
| `set_view` | Persist `timeline` or `graph`. |
| `record_step` | Create or update a semantic milestone. |

All canvas and action inputs use JSON Schema validation.

## How progress is captured

- `onUserPromptSubmitted` records high-level user goals.
- Live `user.message`, `assistant.message`, `assistant.turn_start`,
  `tool.execution_start`, and `tool.execution_complete` events correlate map
  steps with stable chat anchors.
- Tool execution events group related activity into discovery, implementation,
  validation, publication, coordination, or general operation phases.
- `session_map_record_step` captures semantic outcomes that cannot be inferred
  reliably from raw tool events.
- Live `assistant.usage` events add exact input, output, cache-read, and
  cache-write counts to the session and the active goal, phase, or milestone.
- `onSessionEnd` finalizes the active phase and records the session outcome.

Automatic phases are intentionally coarse. Record semantic steps when the
human-readable outcome matters.

## Privacy and local data

Session Map does not send session-map state to an extension-owned remote
service. State is written locally under:

```text
<workspace>/.copilot/session-map/<document-hash>.json
```

The canvas web server listens only on `127.0.0.1`, uses an operating-system
assigned ephemeral port, and closes with its canvas instance.

Persisted automatic activity contains high-level summaries, tool names, numeric
usage counters, and normalized excerpts of user and assistant messages used by
the Chat activity pane. Tool arguments, tool results, and assistant reasoning
are not persisted. User goals, chat excerpts, and descriptions supplied to
semantic steps are persisted as part of the map, so avoid placing secrets or
other sensitive information in those fields. Each document retains at most 400
chat entries. The state files remain after the canvas closes; delete the
workspace's `.copilot/session-map/` directory when you no longer want to retain
them.

## Architecture

```text
Copilot hooks/tool/actions
          |
          v
  state.mjs aggregation
          |
          v
 store.mjs JSON persistence ----> .copilot/session-map/<document-hash>.json
          |
          +----> server.mjs (127.0.0.1, ephemeral port, one per canvas instance)
                          |
                          +----> renderer.mjs (HTML/CSS/SVG)
                          +----> /events (SSE live updates)
```

`extension.mjs` contains SDK wiring and lifecycle coordination. `state.mjs`
contains pure aggregation logic, `store.mjs` serializes mutations and persists
JSON, and `server.mjs` owns loopback HTTP/SSE lifecycle.

Persistent state is keyed by a stable `documentId`, whose default is the
Copilot `sessionId`; it is never keyed by the transient canvas `instanceId`.
Files are stored under `session.workspacePath/.copilot/session-map/`. If
`session.workspacePath` is unavailable, canvas open requests and actions return
an explicit `workspace_unavailable` error, while hooks provide explanatory
context instead of silently falling back to memory.

### State format

```json
{
  "version": 1,
  "documentId": "<stable session id>",
  "sessionId": "<Copilot session id>",
  "view": "timeline",
  "activePhaseId": "phase-3",
  "usage": {
    "inputTokens": 1200,
    "outputTokens": 300,
    "cacheReadTokens": 800,
    "cacheWriteTokens": 100,
    "totalTokens": 1500,
    "modelCalls": 2
  },
  "completion": null,
  "steps": [
    {
      "id": "phase-3",
      "kind": "phase",
      "title": "Implementing changes",
      "status": "in_progress",
      "source": "automatic",
      "dependencies": ["goal-1"],
      "toolNames": ["apply_patch"],
      "activityCount": 1,
      "usage": {
        "inputTokens": 1200,
        "outputTokens": 300,
        "cacheReadTokens": 800,
        "cacheWriteTokens": 100,
        "totalTokens": 1500,
        "modelCalls": 2
      },
      "createdAt": "2026-08-04T12:00:00.000Z",
      "updatedAt": "2026-08-04T12:00:00.000Z"
    }
  ]
}
```

Usage fields are optional, so state documents written before token tracking
remain valid. `totalTokens` is the exact sum of reported input and output
tokens. It is omitted when any captured model call does not provide both values;
cache counters remain separate and are not added again to the total.

## Troubleshooting

### Session Map is not discovered

- Confirm that the entry point is exactly
  `.github/extensions/session-map/extension.mjs`.
- Confirm that the active Copilot workspace is the repository containing that
  path; project extensions are scoped to their workspace.
- Reload extensions after adding or changing the extension.
- List loaded extensions and inspect `session-map`. The inspection output
  includes the extension status and its log-file path when the extension has
  launched.

### The extension fails to load

Inspect the `session-map` extension and read the reported log tail. A syntax
error or unsupported host version should appear there. This extension requires
a GitHub Copilot CLI/app version that supports extension canvases.

Run the syntax checks in [Development and validation](#development-and-validation)
to distinguish an extension source error from a discovery or host problem.

### `workspace_unavailable`

Session Map requires `session.workspacePath` because it persists state inside
the workspace. Start the session from a repository workspace rather than a
context without a workspace path. The extension intentionally does not fall
back to process memory or another directory.

### The canvas does not open, connect, or update

Each open canvas instance binds a new operating-system assigned port on
`127.0.0.1`. There is no fixed port to configure. Check that local security
software permits loopback HTTP connections and ephemeral local ports. Closing
and reopening the canvas starts a fresh server; reloading the extension is the
next step if the extension process itself stopped.

### State cannot be read

Inspect the JSON files under `.copilot/session-map/`. Invalid JSON is reported
as an error rather than silently replaced. If the state is no longer needed,
close the canvas and remove the affected local file so Session Map can create a
new document.

## Limitations

- The SDK exposes live hooks, not a semantic replay API. History from before
  the extension was activated may not be available.
- `assistant.usage` is a transient per-model-call event with no Session Map step
  id. The extension attributes each event to the active step when it arrives.
  Usage emitted while the extension is stopped cannot be replayed, and work
  inside a single active phase cannot be divided more precisely by the current
  SDK.
- Automatic tool phases are intentionally coarse. Semantic phase titles and
  outcomes depend on Copilot calling `session_map_record_step`.
- The current SDK failure hook fires for `failure` results only. Rejected,
  denied, and timed-out tool results are not delivered to
  `onPostToolUseFailure`, so those outcomes cannot be captured automatically.
- An abrupt extension or host process termination may prevent `onSessionEnd`
  from recording completion.
- Canvas APIs are currently marked experimental in the Copilot SDK.
- The extension can synchronize its own map and transcript, but cannot navigate
  or observe the host application's main chat viewport without a future host
  bridge.

## Development and validation

There is no runtime dependency restore or build step. Edit the `.mjs` files
directly, then run the repository's dependency-free checks from its root.

Run unit tests:

```powershell
node --test .github\extensions\session-map\tests\*.test.mjs
```

Run syntax checks:

```powershell
Get-ChildItem .github\extensions\session-map -Filter *.mjs -Recurse |
  ForEach-Object { node --check $_.FullName }
```

Run the browser tests against a deterministic local harness:

```powershell
npm install
npx playwright install chromium
npm run test:ui
```

The Playwright harness starts the real canvas renderer and SSE server with an
in-memory state store, so it does not require a live Copilot SDK session. Every
test uses an ephemeral port bound to `127.0.0.1` and closes its server during
fixture teardown.

For an interactive validation:

1. Reload extensions.
2. Confirm that `session-map` appears in the loaded-extension list and inspect
   its logs for startup errors.
3. Inspect the canvas capabilities and verify the four actions listed above.
4. Open the canvas, record a semantic step, then update it using the returned
   id.
5. Switch between Timeline and Graph and confirm that the update appears
   without reopening the canvas.
6. Close the canvas and confirm that its loopback server stops while the local
   state file remains.
