import { defineConfig } from "@playwright/test";

const port = 3100;

/**
 * Browser regression tests against the production build (`npm run build`
 * first). Every /api/parse call is mocked in the browser (see e2e/fixtures.ts)
 * and the server runs with an empty ANTHROPIC_API_KEY, which Next keeps over
 * .env.local, so no model is ever called. Each test gets a fresh browser
 * profile with synthetic data only.
 */
export default defineConfig({
  testDir: "e2e",
  workers: 1,
  reporter: "list",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    serviceWorkers: "block",
    viewport: { width: 390, height: 844 },
  },
  webServer: {
    command: `npx next start -p ${port} -H 127.0.0.1`,
    url: `http://127.0.0.1:${port}/trip/new`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { ANTHROPIC_API_KEY: "" },
  },
});
