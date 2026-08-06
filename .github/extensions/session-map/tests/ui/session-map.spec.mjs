import { expect, test as base } from "@playwright/test";

import {
    emptyState,
    startTestCanvas,
    stateWithSteps,
} from "./harness.mjs";

const test = base.extend({
    canvasFactory: async ({}, use) => {
        const canvases = new Set();
        await use(async (state = emptyState()) => {
            const canvas = await startTestCanvas(state);
            canvases.add(canvas);
            return canvas;
        });
        await Promise.all([...canvases].map((canvas) => canvas.close()));
    },
});

test("shows the empty timeline state", async ({ canvasFactory, page }) => {
    const canvas = await canvasFactory();
    expect(new URL(canvas.url).hostname).toBe("127.0.0.1");

    await page.goto(canvas.url);

    await expect(
        page.getByRole("heading", { name: "Session Map" }),
    ).toBeVisible();
    await expect(page.getByText("No session milestones yet")).toBeVisible();
    await expect(
        page.getByText("New goals and related tool activity"),
    ).toBeVisible();
    await expect(page.locator("#stepCount")).toHaveText("0");
    await expect(page.locator("#aiCreditTotal")).toHaveText("AIC unknown");
    await expect(page.locator("#connection")).toHaveText("Live");
    await expect(page.locator("#timelineView")).toBeHidden();
    await expect(page.locator("#graphView")).toBeHidden();
});

test("renders step status, details, and dependencies", async ({
    canvasFactory,
    page,
}) => {
    const canvas = await canvasFactory(stateWithSteps());

    await page.goto(canvas.url);

    const timeline = page.getByRole("region", { name: "Session timeline" });
    await expect(timeline).toBeVisible();
    await expect(
        timeline.getByRole("heading", {
            name: "Implementing browser coverage",
        }),
    ).toBeVisible();
    await expect(
        timeline.locator(".step-description", {
            hasText: "Exercising timeline and dependency graph behavior.",
        }),
    ).toBeVisible();
    await expect(
        timeline.locator(".badge.in_progress"),
    ).toBeVisible();
    await expect(
        timeline.locator(".meta span", { hasText: "Depends on research" }),
    ).toBeVisible();
    await expect(page.locator("#stepCount")).toHaveText("2");
    await expect(page.locator("#tokenTotal")).toHaveText("375");
    await expect(page.locator("#aiCreditTotal")).toHaveText("3.75 AIC");
    await expect(
        timeline.locator('[data-step-id="research"] .usage-total'),
    ).toHaveText("125 tokens · 1.25 AIC");
    const researchDetails = timeline.locator(
        '[data-step-id="research"] details',
    );
    await researchDetails.locator("summary").click();
    await expect(researchDetails).toContainText("AI Credit");
    await expect(researchDetails).toContainText("1.25 AIC");
    await expect(page.getByRole("complementary", { name: "Chat activity" })).toBeVisible();
});

test("synchronizes step and transcript selection inside the canvas", async ({
    canvasFactory,
    page,
}) => {
    const canvas = await canvasFactory(stateWithSteps());

    await page.goto(canvas.url);

    const researchCard = page.locator(
        '#timelineView [data-step-id="research"]',
    );
    const implementationEntry = page.locator(
        '.chat-entry[data-step-id="implementation"]',
    );

    await researchCard.click();
    await expect(researchCard).toHaveClass(/selected/);
    await expect(
        page.locator('.chat-entry[data-step-id="research"]'),
    ).toHaveClass(/selected/);
    await expect(page.locator("#transcriptContext")).toContainText(
        "Mapped the canvas architecture",
    );
    const locateResearch = researchCard.getByRole("button", {
        name: "Locate chat activity for Mapped the canvas architecture",
    });
    await locateResearch.focus();
    canvas.recordStep({
        id: "research",
        title: "Mapped the canvas architecture",
        description: "Updated while the locate control retained focus.",
        status: "success",
    });
    await expect(
        page
            .locator('#timelineView [data-step-id="research"]')
            .getByRole("button", {
                name: "Locate chat activity for Mapped the canvas architecture",
            }),
    ).toBeFocused();
    const researchDetails = page.locator(
        '#timelineView [data-step-id="research"] details',
    );
    const researchSummary = researchDetails.locator("summary");
    await researchSummary.click();
    await researchSummary.focus();
    canvas.recordStep({
        id: "research",
        title: "Mapped the canvas architecture",
        description: "Updated while details retained state and focus.",
        status: "success",
    });
    await expect(researchDetails).toHaveAttribute("open", "");
    await expect(researchSummary).toBeFocused();

    await implementationEntry.click();
    await expect(
        page.locator('#timelineView [data-step-id="implementation"]'),
    ).toHaveClass(/selected/);
    await expect(implementationEntry).toHaveClass(/selected/);
    await expect(page.locator("#transcriptContext")).toContainText(
        "Implementing browser coverage",
    );
});

test("toggles the graph and persists the selected view", async ({
    canvasFactory,
    page,
}) => {
    const canvas = await canvasFactory(stateWithSteps());

    await page.goto(canvas.url);
    await page.getByRole("button", { name: "Graph", exact: true }).click();

    await expect(
        page.getByRole("button", { name: "Graph", exact: true }),
    ).toHaveAttribute(
        "aria-pressed",
        "true",
    );
    await expect(
        page.getByRole("region", { name: "Session dependency graph" }),
    ).toBeVisible();
    await expect(
        page.getByRole("group", {
            name: "Dependency graph containing 2 session steps",
        }),
    ).toBeVisible();
    const researchNode = page.locator(
        '#graphView [data-step-id="research"]',
    );
    await researchNode.focus();
    await researchNode.press("ArrowDown");
    await expect(researchNode).not.toHaveClass(/selected/);
    await researchNode.press(" ");
    await expect(researchNode).toHaveClass(/selected/);
    await expect.poll(() => canvas.state().view).toBe("graph");

    await page.reload();

    await expect(
        page.getByRole("button", { name: "Graph", exact: true }),
    ).toHaveAttribute(
        "aria-pressed",
        "true",
    );
    await expect(
        page.getByRole("button", { name: "Timeline" }),
    ).toHaveAttribute("aria-pressed", "false");
});

test("zooms the dependency graph and retains zoom across updates", async ({
    canvasFactory,
    page,
}) => {
    const canvas = await canvasFactory(stateWithSteps());

    await page.goto(canvas.url);
    await page.getByRole("button", { name: "Graph", exact: true }).click();

    const zoomLevel = page.getByLabel("Graph zoom level");
    const graphCanvas = page.locator(".graph-canvas");
    await expect(zoomLevel).toHaveText("100%");
    await expect(
        page.getByRole("button", { name: "Reset graph zoom" }),
    ).toBeDisabled();

    await page.getByRole("button", { name: "Zoom in graph" }).click();
    await expect(zoomLevel).toHaveText("125%");
    await expect
        .poll(() => graphCanvas.evaluate((element) => element.style.width))
        .toBe("125%");

    canvas.recordStep({
        id: "implementation",
        title: "Implementing browser coverage",
        description: "Updated while retaining graph zoom.",
        status: "success",
        dependsOn: ["research"],
    });
    await expect(zoomLevel).toHaveText("125%");

    await page
        .getByLabel("Zoomable dependency graph")
        .dispatchEvent("wheel", { ctrlKey: true, deltaY: 100 });
    await expect(zoomLevel).toHaveText("100%");

    await page.getByRole("button", { name: "Zoom out graph" }).click();
    await expect(zoomLevel).toHaveText("75%");
    await page.getByRole("button", { name: "Reset graph zoom" }).click();
    await expect(zoomLevel).toHaveText("100%");
});

test("applies live SSE state updates", async ({ canvasFactory, page }) => {
    const canvas = await canvasFactory();

    await page.goto(canvas.url);
    await expect(page.locator("#connection")).toHaveText("Live");

    canvas.recordStep({
        id: "validation",
        title: "Browser validation failed",
        description: "The live update reached the open canvas.",
        status: "failure",
    });

    await expect(
        page.getByRole("heading", { name: "Browser validation failed" }),
    ).toBeVisible();
    await expect(page.locator("#stepCount")).toHaveText("1");
    await expect(page.locator("#outcome")).toHaveText("Needs attention");
    await expect(page.getByText("No session milestones yet")).toBeHidden();
});
