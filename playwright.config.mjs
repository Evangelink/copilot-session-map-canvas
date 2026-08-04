import { defineConfig } from "@playwright/test";

export default defineConfig({
    testDir: ".github/extensions/session-map/tests/ui",
    fullyParallel: true,
    outputDir: "test-results",
    reporter: "line",
    use: {
        browserName: "chromium",
        headless: true,
        trace: "retain-on-failure",
    },
});
