import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
    // One embedded PostgreSQL for the whole run; each test file gets its own database.
    globalSetup: ["src/test/global-setup.ts"],
    hookTimeout: 120_000,
  },
});
