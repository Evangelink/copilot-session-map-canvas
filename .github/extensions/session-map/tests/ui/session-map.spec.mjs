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
        timeline.getByText(
            "Exercising timeline and dependency graph behavior.",
        ),
    ).toBeVisible();
    await expect(
        timeline.getByText("in progress", { exact: true }),
    ).toBeVisible();
    await expect(
        timeline.getByText("Depends on research", { exact: false }),
    ).toBeVisible();
    await expect(page.locator("#stepCount")).toHaveText("2");
});

test("toggles the graph and persists the selected view", async ({
    canvasFactory,
    page,
}) => {
    const canvas = await canvasFactory(stateWithSteps());

    await page.goto(canvas.url);
    await page.getByRole("button", { name: "Graph" }).click();

    await expect(page.getByRole("button", { name: "Graph" })).toHaveAttribute(
        "aria-pressed",
        "true",
    );
    await expect(
        page.getByRole("region", { name: "Session dependency graph" }),
    ).toBeVisible();
    await expect(
        page.getByRole("img", {
            name: "Dependency graph containing 2 session steps",
        }),
    ).toBeVisible();
    await expect.poll(() => canvas.state().view).toBe("graph");

    await page.reload();

    await expect(page.getByRole("button", { name: "Graph" })).toHaveAttribute(
        "aria-pressed",
        "true",
    );
    await expect(
        page.getByRole("button", { name: "Timeline" }),
    ).toHaveAttribute("aria-pressed", "false");
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
