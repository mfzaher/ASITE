import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import { HEADERS, summarize } from "../src/lib/dashboard";
import { parseRegister, parseRevision } from "../src/lib/register-parser";

const context = { sourceFile: "E1 shop drawing schedule.xlsx", project: "Test project", package: "P-test" };
const bytes = async (workbook: ExcelJS.Workbook) => new Uint8Array(await workbook.xlsx.writeBuffer());

test("reads named registers, reports unknown fields and excludes material/cancelled rows", async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("STR");
  sheet.addRow(["An E1 schedule"]);
  sheet.addRow(["Drawing Number", "Scope", "Revision", "Status Code", "Submission Date", "L/S", "Document Type"]);
  sheet.addRow(["SD-1", "FOUNDATION", "Rev 00", "Code C", "20/01/2026", "S", "Shop Drawing"]);
  sheet.addRow(["SD-1", "FOUNDATION", "Revision 1", "B - Approved with comments", new Date("2026-01-22T00:00:00Z"), "L", "Shop Drawing"]);
  sheet.addRow(["SD-2", "FORMWORK", "P01", "Custom return", "bad-date", "L", "Shop Drawing"]);
  sheet.addRow(["SD-3", "FORMWORK", 0, "Cancelled", "2026-01-23", "L", "Shop Drawing"]);
  sheet.addRow(["MAT-1", "STEEL", 0, "A", "2026-01-23", "L", "Material Submittal"]);
  const material = workbook.addWorksheet("MATERIALS");
  material.addRow(["Document No", "Revision", "Status"]);
  material.addRow(["MAT-2", 0, "A"]);
  const result = await parseRegister(await bytes(workbook), context);
  assert.equal(result.records.length, 3);
  assert.equal(result.records[0].revision, 0);
  assert.equal(result.records[0].superseded, true);
  assert.equal(result.records[0].status, "C");
  assert.equal(result.records[0].submittedAt, "2026-01-20T00:00:00.000Z");
  assert.equal(result.records[0].dashboardRow, "Shop Drawing Submittals (ECC Str GA)");
  assert.equal(result.records[1].status, "B");
  assert.equal(result.records[2].revision, null);
  assert.equal(result.records[2].submittedAt, null);
  assert.ok(result.warnings.some((warning) => warning.includes("unrecognized revisions")));
  assert.ok(result.warnings.some((warning) => warning.includes("unknown status codes")));
  assert.ok(result.warnings.some((warning) => warning.includes("unrecognized submission dates")));
});

test("uses known classic STR/ARCH/MEP register positions without coercing a missing revision", async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("ARCH");
  sheet.getCell("B15").value = "SD-ARCH-1";
  sheet.getCell("D15").value = "STAIRCASE";
  sheet.getCell("G15").value = 0;
  sheet.getCell("H15").value = "L";
  sheet.getCell("M15").value = "A";
  sheet.getCell("N15").value = 46042;
  sheet.getCell("B16").value = "SD-ARCH-2";
  sheet.getCell("D16").value = "STAIRCASE";
  sheet.getCell("M16").value = "C";
  const result = await parseRegister(await bytes(workbook), context);
  assert.equal(result.records.length, 2);
  assert.equal(result.records[0].dashboardRow, "Shop Drawing Submittals (ECC Arch In-House)");
  assert.equal(result.records[1].revision, null);
  assert.ok(result.records[0].submittedAt);
});

test("rejects a KPI-only workbook gracefully and never uses cached aggregate figures as transactions", async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("REWORK KPI");
  sheet.getRow(3).values = HEADERS;
  sheet.getCell("A4").value = "Test project";
  sheet.getCell("B4").value = "FOUNDATION";
  sheet.getCell("D4").value = { formula: 'COUNTIFS([1]STR!$B$15:$B$2776,"<>")', result: 999 };
  const result = await parseRegister(await bytes(workbook), context);
  assert.deepEqual(result.records, []);
  assert.ok(result.warnings.some((warning) => warning.includes("dashboard template")));
  assert.ok(result.warnings.some((warning) => warning.includes("source sheets are not embedded")));
});

test("revision parsing accepts explicit nonnegative integers only", () => {
  for (const value of [null, undefined, "", "P01", "A", -1, 0.5, "0.0", "Rev unknown"]) assert.equal(parseRevision(value), null);
  for (const value of [0, "00", "REV 0", "Revision: 0", "R0"]) assert.equal(parseRevision(value), 0);
  assert.equal(parseRevision("Rev 12"), 12);
});

test("invalid and rolled-over calendar dates do not create dated rev0 submissions", async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("MEP");
  sheet.addRow(["Document No", "Scope", "Revision", "Status", "Submission Date"]);
  sheet.addRow(["SD-1", "HVAC", 0, "Pending", "2026-02-31"]);
  sheet.addRow(["SD-2", "HVAC", 0, "Pending", "31/02/2026"]);
  sheet.addRow(["SD-3", "HVAC", 0, "Pending", 0]);
  const result = await parseRegister(await bytes(workbook), context);
  result.records.forEach((record) => assert.equal(record.submittedAt, null));
});

test("same register filename in different projects stays distinct while repeat ingestion deduplicates", async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("STR");
  sheet.addRow(["Document No", "Scope", "Revision", "Status"]);
  sheet.addRow(["SD-1", "FOUNDATION", 0, "A"]);
  const data = await bytes(workbook);
  const first = await parseRegister(data, { ...context, project: "Project 1" });
  const second = await parseRegister(data, { ...context, project: "Project 2" });
  const repeated = await parseRegister(data, { ...context, project: "Project 1" });
  const differentPackage = await parseRegister(data, { ...context, project: "Project 1", package: "Other package" });
  assert.equal(summarize([...first.records, ...second.records, ...repeated.records]).recordCount, 2);
  assert.equal(summarize([...first.records, ...differentPackage.records]).recordCount, 2);
  assert.ok(first.warnings.some((warning) => warning.includes("superseded transactions cannot be distinguished")));
});

test("mixed E1/E2 parent folders retain E1 shop sheets while explicit E2 and material data are excluded", async () => {
  const workbook = new ExcelJS.Workbook();
  const headers = ["Document No", "Scope", "Revision", "Status", "Document Type"];
  const shop = workbook.addWorksheet("STR");
  shop.addRow(headers);
  shop.addRow(["E1-SD-1", "FOUNDATION", 0, "A", "E1 Shop Drawing"]);
  shop.addRow(["E2-SD-1", "FOUNDATION", 0, "A", "E2 Shop Drawing"]);
  shop.addRow(["MAT-1", "STEEL", 0, "A", "Material Submittal"]);
  const e2 = workbook.addWorksheet("E2 Shop Drawing");
  e2.addRow(headers);
  e2.addRow(["E2-SD-2", "FOUNDATION", 0, "A", "Shop Drawing"]);
  const materials = workbook.addWorksheet("MATERIALS");
  materials.addRow(headers);
  materials.addRow(["MAT-2", "STEEL", 0, "A", "Material Submittal"]);
  const data = await bytes(workbook);
  const result = await parseRegister(data, { ...context, sourceFile: "05.08 E1 and E2 Schedules/Shop Drawing.xlsx" });
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].documentNo, "E1-SD-1");
  const e2File = await parseRegister(data, { ...context, sourceFile: "05.08 E1 and E2 Schedules/E2 Schedule.xlsx" });
  assert.equal(e2File.records.length, 0);
  assert.ok(e2File.warnings.some((warning) => warning.includes("explicit E2/material register excluded")));
});
