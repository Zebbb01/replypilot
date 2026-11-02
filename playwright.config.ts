import { defineConfig, devices } from "@playwright/test";

// Local stand-ins for the Azure services: an embedded PostgreSQL and the rule-based
// mock model, plus the job worker. Live-inbox secrets are test values.
export const env = {
  DATABASE_URL: "postgres://postgres:postgres@127.0.0.1:54330/postgres",
  LLM_ENDPOINT: "http://127.0.0.1:4021",
  LLM_API_KEY: "local",
  LLM_MODEL: "mock",
  OPERATOR_KEY: "e2e-operator-key",
  INBOUND_EMAIL_SECRET: "e2e-inbound-secret",
  SHOPIFY_CLIENT_SECRET: "e2e-shopify-secret",
  DAILY_DRAFT_CAP: "100000",
  DAILY_DEMO_PER_WORKSPACE: "100000",
  DAILY_DEMO_PER_ADDRESS: "100000",
};

export default defineConfig({
  testDir: "e2e",
  timeout: 120_000,
  // The dev server compiles each route on first use, so the first navigation of a
  // run can take several seconds.
  expect: { timeout: 30_000 },
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: "http://localhost:3300", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "npm run services",
      url: "http://127.0.0.1:4021/health",
      env,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
    {
      command: "npm run dev",
      url: "http://localhost:3300",
      env,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
  ],
});
