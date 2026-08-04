# Session Map

Session Map is a project-scoped GitHub Copilot canvas extension that turns the current Copilot session into a concise visual history. It shows user goals, aggregated work phases, explicit milestones, failures, and session completion in either a chronological timeline or a dependency graph.

The extension is intentionally dependency-free. It uses only Node.js built-ins and the Copilot extension SDK supplied by the CLI.

## Demo

> Screenshot placeholder: open the **Session Map** canvas during an active Copilot session and capture both the Timeline and Graph views.

The Timeline view emphasizes status, time, token usage, and expandable phase details. The Graph view uses the same persisted steps and their `dependencies` to show how goals and milestones lead to later work while keeping token totals compact.

## Installation

This extension is committed at `.github/extensions/session-map/extension.mjs`. Clone the repository and open it with a GitHub Copilot CLI/app version that supports extension canvases. Project extensions are discovered automatically from `.github/extensions/`.

No `npm install`, package manifest, CDN, or separate build step is required. The CLI resolves `@github/copilot-sdk` for the extension process.

## Usage

1. Start a Copilot session in this repository.
2. Ask Copilot to open the `session-map` canvas.
3. Switch between **Timeline** and **Graph** in the canvas. The preference is persisted for the session document.
4. Continue working. User goals and related tool calls update the canvas live over Server-Sent Events.

The extension also contributes `session_map_record_step`. Copilot is instructed to call it after a meaningful phase rather than after each tool invocation. Reusing a returned step id updates an in-progress milestone instead of creating another node.

Agent-facing canvas actions:

| Action | Purpose |
| --- | --- |
| `get_state` | Return the latest persisted document |
| `refresh` | Reload state and push it to open views |
| `set_view` | Persist `timeline` or `graph` |
| `record_step` | Create or update a semantic milestone |

All canvas and action inputs use JSON Schema validation. Semantic step validation also rejects missing dependencies, self-dependencies, and cycles.

## How progress is captured

- `onUserPromptSubmitted` records high-level user goals.
- `onPostToolUse` and `onPostToolUseFailure` group related tool activity into discovery, implementation, validation, publication, coordination, or general operation phases.
- `session_map_record_step` captures semantic outcomes that cannot be inferred reliably from raw tool events.
- Live `assistant.usage` events add exact input, output, cache-read, and cache-write counts to the session and the active goal, phase, or milestone.
- `onSessionEnd` finalizes the active phase and records the session outcome.

Only high-level summaries, tool names, and numeric usage counters are persisted. Tool arguments, prompts, and tool or assistant output are not written to the state file for usage accounting.

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

`extension.mjs` contains only SDK wiring and lifecycle coordination. `state.mjs` is pure aggregation logic, `store.mjs` serializes mutations and persists JSON, and `server.mjs` owns loopback HTTP/SSE lifecycle.

Persistent state is keyed by a stable `documentId` whose default is the Copilot `sessionId`; it is never keyed by the transient canvas `instanceId`. Files are stored under `session.workspacePath/.copilot/session-map/`. If `session.workspacePath` is unavailable, open/actions return an explicit `workspace_unavailable` error and hooks provide explanatory context instead of silently falling back to memory.

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

Usage fields are optional, so state documents written before token tracking remain valid. `totalTokens` is the exact sum of reported input and output tokens. It is omitted when any captured model call does not provide both values; cache counters remain separate and are not added again to the total.

## Limitations

- The SDK exposes live hooks, not a semantic replay API. History from before the extension was activated may not be available.
- `assistant.usage` is a transient per-model-call event with no Session Map step id. The extension attributes each event to the active step when it arrives. Usage emitted while the extension is stopped cannot be replayed, and work inside a single active phase cannot be divided more precisely by the current SDK.
- Automatic tool phases are intentionally coarse. Semantic phase titles and outcomes depend on Copilot calling `session_map_record_step`.
- The current SDK failure hook fires for `failure` results only. Rejected, denied, and timed-out tool results are not delivered to `onPostToolUseFailure`, so those outcomes cannot be captured automatically.
- An abrupt extension or host process termination may prevent `onSessionEnd` from recording completion.
- Canvas APIs are currently marked experimental in the Copilot SDK.

## Development and validation

Run the dependency-free unit tests:

```powershell
node --test .github\extensions\session-map\tests\*.test.mjs
```

Run syntax checks:

```powershell
Get-ChildItem .github\extensions\session-map -Filter *.mjs -Recurse |
  ForEach-Object { node --check $_.FullName }
```

After editing, reload extensions, inspect `session-map`, then validate `list_canvas_capabilities`, `open_canvas`, and `invoke_canvas_action`. The server binds only to `127.0.0.1` and asks the operating system for an ephemeral port.
