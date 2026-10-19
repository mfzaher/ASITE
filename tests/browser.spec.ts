import { test, expect } from "@playwright/test";
import ExcelJS from "exceljs";
import { HEADERS } from "../src/lib/dashboard";
import { readFile } from "node:fs/promises";

test("empty workspace, consistent filtered demo metrics, ledger, and real Excel download", async ({page}) => {
  await page.goto("/registers");
  await expect(page.getByRole("heading", {name: "Drawing intelligence"})).toBeVisible();
  await expect(page.getByText("Your drawing dashboard is ready to begin")).toBeVisible();
  await expect(page.locator(".stat-value").first()).toHaveText("—");
  await page.screenshot({path:"test-results/e1-empty-desktop.png", fullPage:true});
  await page.getByRole("button", {name: "Explore a demo"}).click();
  await expect(page.locator(".stat-value").first()).not.toHaveText("—");
  await page.getByLabel("Filter by discipline").selectOption("MEP");
  await expect(page.getByLabel("Filter by discipline")).toHaveValue("MEP");
  await page.getByRole("button", {name: "Revision ledger", exact:true}).first().click();
  await expect(page.locator(".ledger-table tbody tr")).toHaveCount(12);
  await page.getByRole("button", {name: "Overview", exact:true}).first().click();
  await page.screenshot({path:"test-results/e1-filtered-desktop.png", fullPage:true});
  await page.getByRole("button", {name:"Export Excel", exact:true}).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(/synthetic demo records/)).toBeVisible();
  const pendingDownload = page.waitForEvent("download");
  await dialog.getByRole("button", {name:"Export Excel", exact:true}).click();
  const download = await pendingDownload;
  expect(download.suggestedFilename()).toContain("DEMO");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await readFile((await download.path())!) as never);
  const sheet = workbook.getWorksheet("REWORK KPI")!;
  expect((sheet.getRow(3).values as unknown[]).slice(1)).toEqual(HEADERS);
  expect(workbook.getWorksheet("RAW TRANSACTIONS")!.rowCount).toBe(13);
  expect(sheet.getCell("C4").text).toContain("MEP");
  await page.setViewportSize({width:390,height:844});
  await expect(page.getByRole("heading", {name: "Drawing intelligence"})).toBeVisible();
  await page.screenshot({path:"test-results/e1-mobile.png", fullPage:true});
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
});

test("source register uploads parse actual XLSX cells and materials are excluded", async ({page}) => {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet("STR");
  sheet.addRow(["Document No", "Scope", "Revision", "L/S", "Status", "Submission Date"]);
  sheet.addRow(["TEST-001", "FOUNDATION", 0, "S", "C", "2026-01-01"]);
  sheet.addRow(["TEST-001", "FOUNDATION", 1, "L", "A", "2026-01-02"]);
  sheet.addRow(["TEST-002", "FOUNDATION", 0, "L", "B", "2026-01-01"]);
  const materials = wb.addWorksheet("MATERIALS");
  materials.addRow(["Document No", "Scope", "Revision", "L/S", "Status", "Submission Date"]);
  materials.addRow(["MAT-001", "Concrete", 0, "L", "C", "2026-01-01"]);
  await page.goto("/registers");
  await page.getByRole("button", {name: "Add source", exact:true}).click();
  await page.getByLabel("Project name", {exact:true}).fill("TEST PROJECT");
  await page.getByLabel("Upload E1 shop drawing register").setInputFiles({name:"E1-STR-test.xlsx",mimeType:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",buffer:Buffer.from(await wb.xlsx.writeBuffer())});
  await expect(page.locator(".stat-value").first()).toHaveText("2");
  await page.getByRole("button", {name: "Revision ledger", exact:true}).first().click();
  await expect(page.locator(".ledger-table tbody tr")).toHaveCount(3);
  await expect(page.getByText("MAT-001", {exact:true})).toHaveCount(0);
});

test("host-session form uses memory only and accepts project 388 EI folder alias", async ({page}) => {
  let requestAuth = "";
  await page.route("**/api/asite/projects", async route => {
    const body = route.request().postDataJSON();
    requestAuth = body.authType;
    await route.fulfill({json:{projects:[{id:"workspace-388",name:"J388 Test"}]}});
  });
  await page.route("**/api/asite/folders", route => route.fulfill({json:{folders:[{id:"folder-388",name:"09.03.02 (EI) - Shop Drawing Sheet",path:"09.03.02 (EI) - Shop Drawing Sheet",isE1:true}]}}));
  await page.route("**/api/asite/files", route => route.fulfill({json:{files:[{id:"doc:rev",name:"E1 shop register.xlsx",folderId:"folder-388",folderPath:"09.03.02 (EI) - Shop Drawing Sheet",downloadable:true}]}}));
  await page.route("**/api/asite/register", route => route.fulfill({json:{records:[{id:"test-auto-388",documentNo:"AUTO-001",project:"J388 Test",scope:"FOUNDATION",dashboardRow:"Shop Drawing Submittals (ECC Str GA)",discipline:"STR",package:"",revision:0,status:"A",submittedAt:"2026-01-01T00:00:00.000Z",superseded:false,sourceFile:"E1 shop register.xlsx",sheet:"STR",rowNumber:2}],warnings:[]}}));
  await page.goto("/registers");
  await page.getByRole("button", {name:"Connect Asite", exact:true}).first().click();
  await page.getByRole("tab", {name:"Host-session key"}).click();
  await page.getByLabel("Host-session key", {exact:false}).fill("test-session-key-only");
  await page.getByRole("button", {name:"Connect workspace",exact:true}).click();
  await expect(page.locator(".stat-value").first()).toHaveText("1");
  expect(requestAuth).toBe("session");
  expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);
  await page.getByRole("button", {name:"Connection",exact:true}).first().click();
  await page.getByRole("button", {name:"Select E1 sources"}).click();
  await page.getByRole("button",{name:/Preview E1 folders/}).click();
  await expect(page.getByRole("dialog").getByText("09.03.02 (EI) - Shop Drawing Sheet",{exact:true}).first()).toBeVisible();
});

test("sign-in API failures display a useful safe diagnostic and clear the password", async ({page}) => {
  await page.route("**/api/asite/login", route => route.fulfill({status:401,json:{error:"Asite did not accept the API sign-in. Use a current host-session key.",code:"LOGIN_FAILED",diagnostic:{operation:"login",format:"xml",httpStatus:200,contentType:"application/xml",rootKeys:{AsiteAPIExceptionThrown:"object"},dataKeys:{}}}}));
  await page.goto("/registers");
  await page.getByRole("button",{name:"Connect Asite",exact:true}).first().click();
  await page.getByLabel("Asite email",{exact:false}).fill("person@example.com");
  await page.getByLabel("Password",{exact:true}).fill("fake-password-for-test");
  await page.getByRole("button",{name:"Sign in & connect"}).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("Use a current host-session key");
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("login · XML · HTTP 200");
  await expect(page.getByLabel("Password",{exact:true})).toHaveValue("");
});
