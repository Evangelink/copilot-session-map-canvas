export function renderHtml({ documentId }) {
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Session Map</title>
  <style>
    :root { color-scheme: light dark; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--background-color-default, #ffffff);
      color: var(--text-color-default, #1f2328);
      font-family: var(--font-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
      font-size: var(--text-body-medium, 14px);
      line-height: var(--leading-body-medium, 20px);
    }
    button { font: inherit; }
    .shell { min-height: 100vh; padding: 20px; }
    .header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 18px;
    }
    h1 {
      margin: 0 0 4px;
      font-size: var(--text-title-large, 26px);
      line-height: var(--leading-title-large, 32px);
      font-weight: var(--font-weight-semibold, 600);
    }
    .subtitle, .muted { color: var(--text-color-muted, #59636e); }
    .subtitle { margin: 0; }
    .controls {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .toggle {
      display: inline-flex;
      padding: 3px;
      border: 1px solid var(--border-color-default, #d1d9e0);
      border-radius: 8px;
      background: color-mix(in srgb, var(--background-color-default, #fff) 90%, var(--text-color-default, #1f2328));
    }
    .toggle button, .refresh {
      border: 0;
      border-radius: 6px;
      padding: 6px 10px;
      color: var(--text-color-default, #1f2328);
      background: transparent;
      cursor: pointer;
    }
    .toggle button[aria-pressed="true"] {
      background: var(--background-color-default, #fff);
      box-shadow: 0 1px 3px color-mix(in srgb, var(--text-color-default, #1f2328) 18%, transparent);
      font-weight: var(--font-weight-semibold, 600);
    }
    .refresh {
      border: 1px solid var(--border-color-default, #d1d9e0);
    }
    button:hover { background: color-mix(in srgb, var(--text-color-default, #1f2328) 7%, transparent); }
    button:focus-visible {
      outline: 2px solid var(--color-focus-outline, #0969da);
      outline-offset: 2px;
    }
    .summary {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 10px;
      margin-bottom: 18px;
    }
    .summary-card {
      border: 1px solid var(--border-color-default, #d1d9e0);
      border-radius: 8px;
      padding: 10px 12px;
    }
    .summary-label { display: block; color: var(--text-color-muted, #59636e); font-size: 12px; }
    .summary-value { display: block; margin-top: 2px; font-weight: var(--font-weight-semibold, 600); }
    .connection {
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .connection::before {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--true-color-red, #cf222e);
      content: "";
    }
    .connection.live::before { background: #1a7f37; }
    .content-grid {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(280px, 38%);
      gap: 18px;
      align-items: start;
    }
    .map-pane { min-width: 0; }
    .empty, .error {
      border: 1px dashed var(--border-color-default, #d1d9e0);
      border-radius: 10px;
      padding: 28px;
      text-align: center;
    }
    .error { border-style: solid; color: var(--true-color-red, #cf222e); }
    .timeline {
      position: relative;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .timeline::before {
      position: absolute;
      top: 10px;
      bottom: 10px;
      left: 11px;
      width: 2px;
      background: var(--border-color-default, #d1d9e0);
      content: "";
    }
    .step {
      position: relative;
      display: grid;
      grid-template-columns: 24px minmax(0, 1fr);
      gap: 12px;
      padding-bottom: 16px;
    }
    .dot {
      z-index: 1;
      width: 12px;
      height: 12px;
      margin: 6px;
      border: 2px solid var(--background-color-default, #fff);
      border-radius: 50%;
      background: var(--text-color-muted, #59636e);
      box-shadow: 0 0 0 1px var(--border-color-default, #d1d9e0);
    }
    .dot.success { background: #1a7f37; }
    .dot.failure { background: var(--true-color-red, #cf222e); }
    .dot.in_progress { background: var(--true-color-blue, #0969da); }
    .dot.skipped { background: var(--text-color-muted, #59636e); }
    .step-card {
      min-width: 0;
      border: 1px solid var(--border-color-default, #d1d9e0);
      border-radius: 10px;
      padding: 12px 14px;
      cursor: pointer;
    }
    .step-card:hover {
      border-color: color-mix(in srgb, var(--text-color-default, #1f2328) 35%, var(--border-color-default, #d1d9e0));
    }
    .step-card.selected, .graph-step.selected .graph-node {
      outline: 2px solid var(--color-focus-outline, #0969da);
      outline-offset: 2px;
    }
    .step-card.active, .graph-step.active .graph-node {
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--true-color-blue, #0969da) 18%, transparent);
    }
    .step-card:focus-visible, .graph-step:focus-visible .graph-node {
      outline: 2px solid var(--color-focus-outline, #0969da);
      outline-offset: 2px;
    }
    .step-top {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
    }
    .step-heading-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
    .step-title { margin: 0; font-size: 15px; font-weight: var(--font-weight-semibold, 600); }
    .step-description { margin: 5px 0 0; color: var(--text-color-muted, #59636e); }
    .meta { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; font-size: 12px; color: var(--text-color-muted, #59636e); }
    .badge {
      flex: none;
      border: 1px solid var(--border-color-default, #d1d9e0);
      border-radius: 999px;
      padding: 1px 7px;
      font-size: 12px;
      text-transform: capitalize;
    }
    .badge.failure { color: var(--true-color-red, #cf222e); border-color: var(--true-color-red-muted, #ff8182); }
    .badge.success { color: #1a7f37; }
    .badge.in_progress { color: var(--true-color-blue, #0969da); border-color: var(--true-color-blue-muted, #54aeff); }
    .token-total { white-space: nowrap; color: var(--text-color-muted, #59636e); font-size: 12px; }
    .locate-chat {
      border: 0;
      border-radius: 6px;
      padding: 2px 6px;
      color: var(--true-color-blue, #0969da);
      background: transparent;
      cursor: pointer;
      font-size: 12px;
    }
    details { margin-top: 10px; border-top: 1px solid var(--border-color-default, #d1d9e0); padding-top: 8px; }
    details summary { width: fit-content; cursor: pointer; color: var(--text-color-muted, #59636e); font-weight: var(--font-weight-semibold, 600); }
    details summary:focus-visible { outline: 2px solid var(--color-focus-outline, #0969da); outline-offset: 2px; }
    .details-grid {
      display: grid;
      grid-template-columns: minmax(110px, auto) minmax(0, 1fr);
      gap: 6px 14px;
      margin: 10px 0 0;
    }
    .details-grid dt { color: var(--text-color-muted, #59636e); }
    .details-grid dd { margin: 0; overflow-wrap: anywhere; }
    .graph-wrap {
      overflow: auto;
      border: 1px solid var(--border-color-default, #d1d9e0);
      border-radius: 10px;
      min-height: 360px;
    }
    svg { display: block; min-width: 760px; width: 100%; }
    .graph-edge { fill: none; stroke: var(--border-color-default, #8c959f); stroke-width: 2; }
    .graph-node { fill: var(--background-color-default, #fff); stroke: var(--border-color-default, #d1d9e0); stroke-width: 1.5; }
    .graph-node.success { stroke: #1a7f37; }
    .graph-node.failure { stroke: var(--true-color-red, #cf222e); }
    .graph-node.in_progress { stroke: var(--true-color-blue, #0969da); }
    .graph-title { fill: var(--text-color-default, #1f2328); font-weight: 600; font-size: 13px; }
    .graph-meta { fill: var(--text-color-muted, #59636e); font-size: 11px; }
    .graph-step { cursor: pointer; }
    .transcript {
      position: sticky;
      top: 16px;
      overflow: hidden;
      border: 1px solid var(--border-color-default, #d1d9e0);
      border-radius: 10px;
      background: var(--background-color-default, #fff);
    }
    .transcript-header {
      padding: 12px 14px;
      border-bottom: 1px solid var(--border-color-default, #d1d9e0);
    }
    .transcript-title { margin: 0; font-size: 15px; }
    .transcript-context { margin: 3px 0 0; font-size: 12px; }
    .transcript-list {
      display: grid;
      gap: 1px;
      max-height: calc(100vh - 230px);
      overflow: auto;
      background: var(--border-color-default, #d1d9e0);
    }
    .chat-entry {
      width: 100%;
      border: 0;
      padding: 10px 12px;
      color: var(--text-color-default, #1f2328);
      background: var(--background-color-default, #fff);
      text-align: left;
      cursor: pointer;
    }
    .chat-entry:hover { background: color-mix(in srgb, var(--true-color-blue, #0969da) 7%, var(--background-color-default, #fff)); }
    .chat-entry.selected { background: color-mix(in srgb, var(--true-color-blue, #0969da) 13%, var(--background-color-default, #fff)); }
    .chat-entry.active { border-left: 3px solid var(--true-color-blue, #0969da); padding-left: 9px; }
    .chat-entry-top { display: flex; justify-content: space-between; gap: 8px; font-size: 12px; }
    .chat-entry-kind { color: var(--text-color-muted, #59636e); text-transform: capitalize; }
    .chat-entry-content {
      display: -webkit-box;
      margin-top: 4px;
      overflow: hidden;
      color: var(--text-color-muted, #59636e);
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 4;
    }
    .transcript-empty { margin: 0; padding: 18px 14px; }
    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }
    [hidden] { display: none !important; }
    @media (max-width: 680px) {
      .shell { padding: 14px; }
      .header { flex-direction: column; }
      .summary { grid-template-columns: 1fr; }
      .content-grid { grid-template-columns: 1fr; }
      .transcript { position: static; }
      .transcript-list { max-height: 420px; }
      .controls { width: 100%; justify-content: space-between; }
      .step-top { flex-direction: column; }
      .step-heading-meta { justify-content: flex-start; }
      .details-grid { grid-template-columns: 1fr; gap: 2px; }
      .details-grid dd { margin-bottom: 6px; }
    }
  </style>
</head>
<body>
  <main class="shell">
    <header class="header">
      <div>
        <h1>Session Map</h1>
        <p class="subtitle">Goals, meaningful phases, and their dependencies.</p>
      </div>
      <div class="controls">
        <div class="toggle" role="group" aria-label="Session Map view">
          <button id="timelineButton" type="button" aria-pressed="true">Timeline</button>
          <button id="graphButton" type="button" aria-pressed="false">Graph</button>
        </div>
        <button class="refresh" id="refreshButton" type="button">Refresh</button>
      </div>
    </header>
    <section class="summary" aria-label="Session summary">
      <div class="summary-card"><span class="summary-label">Steps</span><span class="summary-value" id="stepCount">0</span></div>
      <div class="summary-card"><span class="summary-label">Total tokens</span><span class="summary-value" id="tokenTotal">Unknown</span></div>
      <div class="summary-card"><span class="summary-label">Outcome</span><span class="summary-value" id="outcome">In progress</span></div>
      <div class="summary-card"><span class="summary-label">Updates</span><span class="summary-value connection" id="connection" role="status">Connecting</span></div>
    </section>
    <div id="error" class="error" role="alert" hidden></div>
    <div class="content-grid">
      <div class="map-pane">
        <section id="empty" class="empty">
          <strong>No session milestones yet</strong>
          <p class="muted">New goals and related tool activity will appear here automatically.</p>
        </section>
        <section id="timelineView" aria-label="Session timeline"></section>
        <section id="graphView" aria-label="Session dependency graph" hidden></section>
      </div>
      <aside class="transcript" aria-label="Chat activity">
        <header class="transcript-header">
          <h2 class="transcript-title">Chat activity</h2>
          <p class="transcript-context muted" id="transcriptContext">Select a step to locate its chat activity.</p>
        </header>
        <div class="transcript-list" id="transcriptList"></div>
      </aside>
    </div>
  </main>
  <script>
    const documentId = ${JSON.stringify(documentId)};
    const elements = {
      connection: document.getElementById("connection"),
      empty: document.getElementById("empty"),
      error: document.getElementById("error"),
      graph: document.getElementById("graphView"),
      graphButton: document.getElementById("graphButton"),
      outcome: document.getElementById("outcome"),
      refresh: document.getElementById("refreshButton"),
      stepCount: document.getElementById("stepCount"),
      tokenTotal: document.getElementById("tokenTotal"),
      timeline: document.getElementById("timelineView"),
      timelineButton: document.getElementById("timelineButton"),
      transcriptContext: document.getElementById("transcriptContext"),
      transcriptList: document.getElementById("transcriptList"),
    };
    let currentState;
    let selectedStepId;
    let selectionPinned = false;

    function text(value) {
      return document.createTextNode(value ?? "");
    }

    function formatStatus(status) {
      return status.replace("_", " ");
    }

    function formatTime(value) {
      const date = new Date(value);
      return Number.isNaN(date.getTime())
        ? "Unknown time"
        : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
    }

    function formatTokens(value) {
      return Number.isSafeInteger(value) && value >= 0
        ? new Intl.NumberFormat().format(value)
        : "Unknown";
    }

    function tokenTotal(value) {
      const formatted = formatTokens(value);
      return formatted === "Unknown" ? "Tokens unknown" : formatted + " tokens";
    }

    function formatDuration(startValue, endValue) {
      const start = new Date(startValue);
      const end = new Date(endValue);
      const milliseconds = end.getTime() - start.getTime();
      if (!Number.isFinite(milliseconds) || milliseconds < 0) return "Unknown";
      if (milliseconds < 1000) return "<1 second";
      const seconds = Math.floor(milliseconds / 1000);
      if (seconds < 60) return seconds + " second" + (seconds === 1 ? "" : "s");
      const minutes = Math.floor(seconds / 60);
      if (minutes < 60) return minutes + " minute" + (minutes === 1 ? "" : "s");
      const hours = Math.floor(minutes / 60);
      if (hours < 24) return hours + " hour" + (hours === 1 ? "" : "s");
      const days = Math.floor(hours / 24);
      return days + " day" + (days === 1 ? "" : "s");
    }

    function appendDetail(list, label, value) {
      const term = document.createElement("dt");
      term.append(text(label));
      const description = document.createElement("dd");
      description.append(text(value));
      list.append(term, description);
    }

    function showError(message) {
      elements.error.textContent = message;
      elements.error.hidden = !message;
    }

    function createTimeline(steps) {
      const list = document.createElement("ol");
      list.className = "timeline";
      for (const step of steps) {
        const item = document.createElement("li");
        item.className = "step";
        const dot = document.createElement("span");
        dot.className = "dot " + step.status;
        dot.setAttribute("aria-hidden", "true");
        const card = document.createElement("article");
        card.className = "step-card";
        card.dataset.stepId = step.id;
        const top = document.createElement("div");
        top.className = "step-top";
        const title = document.createElement("h2");
        title.className = "step-title";
        title.append(text(step.title));
        const badge = document.createElement("span");
        badge.className = "badge " + step.status;
        badge.append(text(formatStatus(step.status)));
        const headingMeta = document.createElement("div");
        headingMeta.className = "step-heading-meta";
        const tokens = document.createElement("span");
        tokens.className = "token-total";
        tokens.append(text(tokenTotal(step.usage?.totalTokens)));
        const locateChat = document.createElement("button");
        locateChat.type = "button";
        locateChat.className = "locate-chat";
        locateChat.append(text("Locate chat"));
        locateChat.setAttribute("aria-label", "Locate chat activity for " + step.title);
        headingMeta.append(locateChat, tokens, badge);
        top.append(title, headingMeta);
        card.append(top);
        if (step.description) {
          const description = document.createElement("p");
          description.className = "step-description";
          description.append(text(step.description));
          card.append(description);
        }
        const meta = document.createElement("div");
        meta.className = "meta";
        meta.append(text(formatTime(step.updatedAt)));
        if (step.activityCount) {
          const activity = document.createElement("span");
          activity.append(text("• " + step.activityCount + " activities"));
          meta.append(activity);
        }
        if (step.dependencies.length) {
          const dependencies = document.createElement("span");
          dependencies.append(text("• Depends on " + step.dependencies.join(", ")));
          meta.append(dependencies);
        }
        card.append(meta);
        const details = document.createElement("details");
        const detailsSummary = document.createElement("summary");
        detailsSummary.append(text("Step details"));
        const detailsGrid = document.createElement("dl");
        detailsGrid.className = "details-grid";
        appendDetail(detailsGrid, "Description", step.description || "No description provided.");
        appendDetail(detailsGrid, "Status", formatStatus(step.status));
        appendDetail(detailsGrid, "Source", step.source || "Unknown");
        appendDetail(detailsGrid, "Category", step.category || "Not applicable");
        appendDetail(detailsGrid, "Dependencies", step.dependencies.length ? step.dependencies.join(", ") : "None");
        appendDetail(detailsGrid, "Tools", step.toolNames?.length ? step.toolNames.join(", ") : "None recorded");
        appendDetail(detailsGrid, "Activity count", Number.isSafeInteger(step.activityCount) ? String(step.activityCount) : "Unknown");
        appendDetail(detailsGrid, "Started", formatTime(step.createdAt));
        appendDetail(detailsGrid, "Updated", formatTime(step.updatedAt));
        appendDetail(detailsGrid, "Duration", formatDuration(step.createdAt, step.updatedAt));
        appendDetail(detailsGrid, "Total tokens", formatTokens(step.usage?.totalTokens));
        appendDetail(detailsGrid, "Input tokens", formatTokens(step.usage?.inputTokens));
        appendDetail(detailsGrid, "Output tokens", formatTokens(step.usage?.outputTokens));
        appendDetail(detailsGrid, "Cache-read tokens", formatTokens(step.usage?.cacheReadTokens));
        appendDetail(detailsGrid, "Cache-write tokens", formatTokens(step.usage?.cacheWriteTokens));
        appendDetail(detailsGrid, "Model calls", formatTokens(step.usage?.modelCalls));
        appendDetail(detailsGrid, "Chat anchors", String(step.chat?.eventIds?.length ?? 0));
        details.append(detailsSummary, detailsGrid);
        card.append(details);
        item.append(dot, card);
        list.append(item);
      }
      return list;
    }

    function svgElement(name, attributes = {}) {
      const element = document.createElementNS("http://www.w3.org/2000/svg", name);
      for (const [key, value] of Object.entries(attributes)) {
        element.setAttribute(key, value);
      }
      return element;
    }

    function truncate(value, length) {
      return value.length > length ? value.slice(0, length - 1) + "…" : value;
    }

    function createGraph(steps) {
      const wrapper = document.createElement("div");
      wrapper.className = "graph-wrap";
      const lane = { goal: 35, phase: 285, milestone: 535, completion: 285 };
      const positions = new Map();
      steps.forEach((step, index) => {
        positions.set(step.id, { x: lane[step.kind] ?? 285, y: 34 + index * 118 });
      });
      const height = Math.max(360, 74 + steps.length * 118);
      const svg = svgElement("svg", {
        viewBox: "0 0 800 " + height,
        role: "group",
        "aria-label": "Dependency graph containing " + steps.length + " session steps",
      });
      for (const step of steps) {
        const target = positions.get(step.id);
        for (const dependencyId of step.dependencies) {
          const source = positions.get(dependencyId);
          if (!source) continue;
          const startX = source.x + 110;
          const startY = source.y + 66;
          const endX = target.x + 110;
          const endY = target.y;
          const middleY = (startY + endY) / 2;
          svg.append(svgElement("path", {
            class: "graph-edge",
            d: "M " + startX + " " + startY + " C " + startX + " " + middleY + ", " + endX + " " + middleY + ", " + endX + " " + endY,
          }));
        }
      }
      for (const step of steps) {
        const position = positions.get(step.id);
        const group = svgElement("g");
        group.setAttribute("class", "graph-step");
        group.setAttribute("data-step-id", step.id);
        group.setAttribute("tabindex", "0");
        group.setAttribute("role", "button");
        group.setAttribute("aria-label", "Locate chat activity for " + step.title);
        const rect = svgElement("rect", {
          class: "graph-node " + step.status,
          x: position.x,
          y: position.y,
          width: 220,
          height: 66,
          rx: 9,
        });
        const title = svgElement("text", {
          class: "graph-title",
          x: position.x + 12,
          y: position.y + 25,
        });
        title.append(text(truncate(step.title, 28)));
        const meta = svgElement("text", {
          class: "graph-meta",
          x: position.x + 12,
          y: position.y + 47,
        });
        meta.append(text(formatStatus(step.status) + " • " + tokenTotal(step.usage?.totalTokens)));
        group.append(rect, title, meta);
        svg.append(group);
      }
      const accessibleList = document.createElement("ol");
      accessibleList.className = "sr-only";
      for (const step of steps) {
        const item = document.createElement("li");
        item.append(text(step.title + ", " + formatStatus(step.status) + ", " + tokenTotal(step.usage?.totalTokens) + (step.dependencies.length ? ", depends on " + step.dependencies.join(", ") : "")));
        accessibleList.append(item);
      }
      wrapper.append(svg, accessibleList);
      return wrapper;
    }

    function createTranscript(events) {
      const fragment = document.createDocumentFragment();
      if (!events.length) {
        const empty = document.createElement("p");
        empty.className = "transcript-empty muted";
        empty.append(text("Chat anchors will appear as new session activity is recorded."));
        fragment.append(empty);
        return fragment;
      }
      for (const event of events) {
        const entry = document.createElement("button");
        entry.type = "button";
        entry.className = "chat-entry";
        entry.dataset.eventId = event.id;
        if (event.stepId) entry.dataset.stepId = event.stepId;
        const top = document.createElement("span");
        top.className = "chat-entry-top";
        const title = document.createElement("strong");
        title.append(text(event.title || event.type));
        const kind = document.createElement("span");
        kind.className = "chat-entry-kind";
        kind.append(text(event.status && event.type === "tool" ? formatStatus(event.status) : event.type));
        top.append(title, kind);
        const content = document.createElement("span");
        content.className = "chat-entry-content";
        content.append(text(event.content || formatTime(event.timestamp)));
        entry.append(top, content);
        entry.disabled = !event.stepId;
        fragment.append(entry);
      }
      return fragment;
    }

    function elementsForStep(stepId) {
      if (!stepId) return [];
      return [...document.querySelectorAll('[data-step-id="' + CSS.escape(stepId) + '"]')];
    }

    function applySelection({ scrollMap = false, scrollTranscript = false } = {}) {
      document.querySelectorAll("[data-step-id].selected").forEach((element) => element.classList.remove("selected"));
      document.querySelectorAll("[data-step-id].active").forEach((element) => element.classList.remove("active"));
      for (const element of elementsForStep(currentState?.activeChatStepId)) {
        element.classList.add("active");
      }
      for (const element of elementsForStep(selectedStepId)) {
        element.classList.add("selected");
      }

      const step = currentState?.steps?.find((candidate) => candidate.id === selectedStepId);
      const relatedCount = currentState?.chatEvents?.filter((event) => event.stepId === selectedStepId).length ?? 0;
      elements.transcriptContext.textContent = step
        ? step.title + " · " + relatedCount + " chat " + (relatedCount === 1 ? "anchor" : "anchors")
        : "Select a step to locate its chat activity.";

      if (scrollMap && selectedStepId) {
        const selector = (currentState.view === "graph" ? "#graphView " : "#timelineView ") +
          '[data-step-id="' + CSS.escape(selectedStepId) + '"]';
        document.querySelector(selector)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
      if (scrollTranscript && selectedStepId) {
        elements.transcriptList
          .querySelector('.chat-entry[data-step-id="' + CSS.escape(selectedStepId) + '"]')
          ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    }

    function selectStep(stepId, options = {}) {
      if (!currentState?.steps?.some((step) => step.id === stepId)) return;
      selectedStepId = stepId;
      selectionPinned = options.pinned ?? true;
      applySelection(options);
    }

    function captureDynamicFocus() {
      const focused = document.activeElement;
      if (focused?.classList.contains("chat-entry")) {
        return { kind: "chat", eventId: focused.dataset.eventId };
      }
      if (focused?.classList.contains("locate-chat")) {
        return { kind: "locate", stepId: focused.closest("[data-step-id]")?.dataset.stepId };
      }
      if (focused?.tagName === "SUMMARY") {
        return { kind: "summary", stepId: focused.closest("[data-step-id]")?.dataset.stepId };
      }
      const graphStep = focused?.closest?.(".graph-step[data-step-id]");
      return graphStep ? { kind: "graph", stepId: graphStep.dataset.stepId } : null;
    }

    function restoreDynamicFocus(focus) {
      if (!focus) return;
      const selector = focus.kind === "chat"
        ? '.chat-entry[data-event-id="' + CSS.escape(focus.eventId) + '"]'
        : focus.kind === "locate"
          ? '#timelineView [data-step-id="' + CSS.escape(focus.stepId) + '"] .locate-chat'
          : focus.kind === "summary"
            ? '#timelineView [data-step-id="' + CSS.escape(focus.stepId) + '"] details summary'
          : '#graphView [data-step-id="' + CSS.escape(focus.stepId) + '"]';
      document.querySelector(selector)?.focus({ preventScroll: true });
    }

    function render(state) {
      const focus = captureDynamicFocus();
      const expandedStepIds = [
        ...elements.timeline.querySelectorAll("[data-step-id] details[open]"),
      ].map((details) => details.closest("[data-step-id]").dataset.stepId);
      currentState = state;
      showError("");
      const steps = state.steps ?? [];
      elements.stepCount.textContent = String(steps.length);
      elements.tokenTotal.textContent = formatTokens(state.usage?.totalTokens);
      elements.outcome.textContent = state.completion
        ? formatStatus(state.completion.status)
        : steps.some((step) => step.status === "failure")
          ? "Needs attention"
          : "In progress";
      elements.empty.hidden = steps.length > 0;
      elements.timeline.replaceChildren(...(steps.length ? [createTimeline(steps)] : []));
      elements.graph.replaceChildren(...(steps.length ? [createGraph(steps)] : []));
      elements.transcriptList.replaceChildren(createTranscript(state.chatEvents ?? []));
      for (const stepId of expandedStepIds) {
        elements.timeline
          .querySelector(
            '[data-step-id="' + CSS.escape(stepId) + '"] details',
          )
          ?.setAttribute("open", "");
      }
      const graphActive = state.view === "graph";
      elements.timeline.hidden = graphActive || steps.length === 0;
      elements.graph.hidden = !graphActive || steps.length === 0;
      elements.timelineButton.setAttribute("aria-pressed", String(!graphActive));
      elements.graphButton.setAttribute("aria-pressed", String(graphActive));
      if (!steps.some((step) => step.id === selectedStepId)) {
        selectedStepId = undefined;
        selectionPinned = false;
      }
      if (!selectionPinned && state.activeChatStepId) {
        selectedStepId = state.activeChatStepId;
      }
      applySelection({
        scrollMap: !selectionPinned && Boolean(selectedStepId),
        scrollTranscript: !selectionPinned && Boolean(selectedStepId),
      });
      restoreDynamicFocus(focus);
      document.title = "Session Map · " + documentId;
    }

    async function post(path, body = {}) {
      const response = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error ?? "Request failed.");
      return value;
    }

    async function setView(view) {
      try {
        render(await post("/api/view", { view }));
      } catch (error) {
        showError(error.message);
      }
    }

    elements.timelineButton.addEventListener("click", () => setView("timeline"));
    elements.graphButton.addEventListener("click", () => setView("graph"));
    function mapSelection(event) {
      if (
        event.type === "keydown" &&
        event.key !== "Enter" &&
        event.key !== " "
      ) {
        return;
      }
      const target = event.target.closest("[data-step-id]");
      if (!target || target.classList.contains("chat-entry")) return;
      if (event.type === "keydown") event.preventDefault();
      selectStep(target.dataset.stepId, { scrollTranscript: true, pinned: true });
    }
    elements.timeline.addEventListener("click", mapSelection);
    elements.graph.addEventListener("click", mapSelection);
    elements.graph.addEventListener("keydown", mapSelection);
    elements.transcriptList.addEventListener("click", (event) => {
      const entry = event.target.closest(".chat-entry[data-step-id]");
      if (entry) selectStep(entry.dataset.stepId, { scrollMap: true, pinned: true });
    });
    elements.refresh.addEventListener("click", async () => {
      try {
        render(await post("/api/refresh"));
      } catch (error) {
        showError(error.message);
      }
    });

    fetch("/state")
      .then((response) => response.json())
      .then(render)
      .catch((error) => showError(error.message));

    const events = new EventSource("/events");
    events.addEventListener("open", () => {
      elements.connection.textContent = "Live";
      elements.connection.classList.add("live");
    });
    events.addEventListener("state", (event) => render(JSON.parse(event.data)));
    events.addEventListener("error", () => {
      elements.connection.textContent = "Reconnecting";
      elements.connection.classList.remove("live");
    });
  </script>
</body>
</html>`;
}
