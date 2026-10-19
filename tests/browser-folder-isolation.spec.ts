import { test, expect, type Page } from "@playwright/test";
import type { RegisterRecord } from "../src/lib/dashboard";

const folders = [
  { id: "folder-parent", name: "09.03.02 (EI) - Shop Drawing Sheet", path: "09.03.02 (EI) - Shop Drawing Sheet", isE1: true },
  { id: "folder-child", name: "Structural schedules", path: "09.03.02 (EI) - Shop Drawing Sheet / Structural schedules", parentId: "folder-parent", isE1: true },
];
const record: RegisterRecord = {
  id: "folder-isolation-record", documentNo: "DRAWING-001", project: "J388 Test", scope: "FOUNDATION",
  dashboardRow: "Shop Drawing Submittals (ECC Str GA)", discipline: "STR", package: "E1",
  revision: 0, status: "A", submittedAt: "2026-01-01T00:00:00.000Z", superseded: false,
  sourceFile: "E1 structural register.xlsx", sheet: "STR", rowNumber: 2,
};
const file = { id: "document-revision", name: record.sourceFile, folderId: "folder-child", folderPath: folders[1].path, downloadable: true };

async function mockConnection(page: Page) {
  await page.route("**/api/asite/session", route => route.fulfill({ json: { configured: false, connected: false } }));
  await page.route("**/api/asite/projects", route => route.fulfill({ json: { projects: [{ id: "workspace-388", name: "J388 Test" }] } }));
  await page.route("**/api/asite/folders", route => route.fulfill({ json: { folders } }));
  await page.route("**/api/asite/register", route => route.fulfill({ json: { records: [record], warnings: [] } }));
}

async function connectHostSession(page: Page) {
  await page.goto("/registers");
  await page.getByRole("button", { name: "Connect Asite", exact: true }).first().click();
  await page.getByRole("tab", { name: "Host-session key" }).click();
  await page.getByLabel("Host-session key", { exact: false }).fill("test-session-for-mocked-requests");
  await page.getByRole("button", { name: "Connect workspace", exact: true }).click();
  await expect(page.locator(".stat-value").first()).toHaveText("1");
}

test("a failed E1 folder preserves sibling records and requires partial export review", async ({ page }) => {
  await mockConnection(page);
  const folderRequests: string[][] = [];
  await page.route("**/api/asite/files", async route => {
    const { folderIds } = route.request().postDataJSON() as { folderIds: string[] };
    folderRequests.push(folderIds);
    if (folderIds[0] === "folder-parent") {
      await route.fulfill({ status: 502, json: { error: "This folder's document listing could not be read." } });
    } else {
      await route.fulfill({ json: { files: [file] } });
    }
  });
  await connectHostSession(page);
  expect(folderRequests).toEqual([["folder-parent"], ["folder-child"]]);
  await expect(page.locator(".stat-value")).toHaveText(["1", "1", "1", "0"]);
  await expect(page.getByText(/Extraction needs review/)).toBeVisible();
  await page.getByRole("button", { name: "View details", exact: true }).click();
  await expect(page.locator(".notice-list")).toContainText("J388 Test / 09.03.02 (EI) - Shop Drawing Sheet");
  await expect(page.locator(".notice-list")).toContainText("This folder's document listing could not be read.");
  await page.getByRole("button", { name: "Export Excel", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Extraction is incomplete.", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Export partial dashboard" })).toBeVisible();
});

test("an empty E1 parent is normal and extraction continues into its child folder", async ({ page }) => {
  await mockConnection(page);
  const folderRequests: string[][] = [];
  await page.route("**/api/asite/files", async route => {
    const { folderIds } = route.request().postDataJSON() as { folderIds: string[] };
    folderRequests.push(folderIds);
    await route.fulfill({ json: { files: folderIds[0] === "folder-parent" ? [] : [file] } });
  });
  await connectHostSession(page);
  expect(folderRequests).toEqual([["folder-parent"], ["folder-child"]]);
  await expect(page.locator(".stat-value")).toHaveText(["1", "1", "1", "0"]);
  await expect(page.locator(".notice")).toHaveCount(0);
  await expect(page.getByText(/Incomplete extraction/)).toHaveCount(0);
  await page.getByRole("button", { name: "Revision ledger", exact: true }).first().click();
  await expect(page.locator(".ledger-table tbody tr")).toHaveCount(1);
  await expect(page.locator(".ledger-table tbody tr")).toContainText("DRAWING-001");
});
