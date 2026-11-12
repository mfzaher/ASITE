import { test, expect } from "@playwright/test";

test("ECC Intelligence surfaces only grounded project answers and works on mobile", async ({ page }) => {
  test.setTimeout(60_000);
  const crashes: string[] = [];
  page.on("pageerror", (error) => crashes.push(error.message));

  await page.goto("/assistant");
  await expect(page.getByRole("heading", { name: "Ask your project data." })).toBeVisible();
  await expect(page.getByRole("button", { name: /Approval status/ })).toBeEnabled();
  await expect(page.getByText("No write actions", { exact: false })).toBeVisible();
  await page.screenshot({ path: "test-results/ecc-intelligence-desktop.png", fullPage: true });

  await page.getByRole("button", { name: /Approval status/ }).click();
  await expect(page.getByText("I cannot verify ASITE drawing approvals", { exact: false })).toBeVisible();
  await expect(page.getByText("Source unavailable")).toBeVisible();

  const request = await page.request.post("/api/control/assistant", {
    headers: { Origin: "http://127.0.0.1:3000" },
    data: { query: "project overview", month: "2026-10" },
  });
  expect(request.status()).toBe(200);
  const response = await request.json();
  expect(response.status).toBe("unavailable");
  expect(response.citations).toHaveLength(0);
  expect(response.answer).not.toContain("demo-project-1");

  const denied = await page.request.post("/api/control/assistant", {
    headers: { Origin: "https://untrusted.example" },
    data: { query: "project overview" },
  });
  expect(denied.status()).toBe(403);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("heading", { name: "Ask your project data." })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.screenshot({ path: "test-results/ecc-intelligence-mobile.png", fullPage: true });
  expect(crashes).toEqual([]);
});
