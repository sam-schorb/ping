import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./apps/web/e2e",
  timeout: 30000,
  use: {
    baseURL: "http://127.0.0.1:3007",
    headless: true,
  },
  webServer: {
    command: "npm run start -w apps/web -- --hostname 127.0.0.1 --port 3007",
    cwd: ".",
    url: "http://127.0.0.1:3007",
    reuseExistingServer: true,
    timeout: 120000,
  },
});
