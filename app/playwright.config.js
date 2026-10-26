import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
  retries: 0,
  use: {
    baseURL: "http://127.0.0.1:8788",
    acceptDownloads: true,
  },
  webServer: {
    command: "npx wrangler pages dev --port 8788",
    url: "http://127.0.0.1:8788/data/quiz-cat.json",
    reuseExistingServer: true,
    timeout: 180_000,
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
