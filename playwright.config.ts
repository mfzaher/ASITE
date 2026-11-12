import { defineConfig } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
const remoteBase = process.env.PLAYWRIGHT_BASE_URL;
export default defineConfig({
  testDir: "./tests",
  testMatch: [
    "browser.spec.ts",
    "browser-folder-isolation.spec.ts",
    "governance-browser.spec.ts",
    "assistant-browser.spec.ts",
  ],
  workers: 1,
  use: {
    baseURL: remoteBase || "http://127.0.0.1:3000",
    headless: true,
    viewport: { width: 1440, height: 1000 },
    launchOptions: {
      executablePath:
        process.env.CHROMIUM_PATH ||
        (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined),
      args: ["--no-sandbox"],
    },
  },
  webServer: remoteBase
    ? undefined
    : {
        command: "npm run dev:demo -- --port 3000",
        env: {
          ECC_LOCAL_MODE: "1",
          ECC_PUBLIC_ORIGIN: "http://127.0.0.1:3000",
          ECC_DATABASE_PATH: resolve(`.data/e2e-${randomUUID()}.sqlite`),
        },
        url: "http://127.0.0.1:3000",
        reuseExistingServer: false,
        timeout: 120000,
      },
  reporter: "list",
});
