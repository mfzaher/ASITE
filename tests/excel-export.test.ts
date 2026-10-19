import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import { buildDashboard, generateDemoRecords, HEADERS } from "../src/lib/dashboard";
import { exportDashboard } from "../src/lib/excel-export";
import { parseRegister } from "../src/lib/register-parser";

test("export has exact source headers, internally calculated KPIs, high-revision totals and audit rows", async () => {
  const records = generateDemoRecords();
  const data = await exportDashboard(records, { source: "Fictional test input" });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(data as never);
  const dashboard = workbook.getWorksheet("REWORK KPI")!;
  const raw = workbook.getWorksheet("RAW TRANSACTIONS")!;
  assert.deepEqual((dashboard.getRow(3).values as ExcelJS.CellValue[]).slice(1), HEADERS);
  assert.equal(raw.rowCount, records.length + 1);
  assert.ok(workbook.getWorksheet("NOTES"));
  const expected = buildDashboard(records);
  expected.forEach((row, index) => {
    const excelRow = dashboard.getRow(index + 4);
    for (let column = 1; column <= 29; column++) {
      const value = excelRow.getCell(column).value;
      if (column >= 19 && column <= 28) {
        assert.ok(value && typeof value === "object" && "formula" in value);
        assert.equal(excelRow.getCell(column).result, row.values[column - 1]);
        assert.equal((value as ExcelJS.CellFormulaValue).formula.includes("["), false);
      } else assert.equal(value, row.values[column - 1]);
    }
  });
  const parsed = await parseRegister(data, { sourceFile: "export.xlsx", project: "DEMO PROJECT" });
  assert.equal(parsed.records.length, records.length);
  assert.equal(parsed.records.filter((record) => record.revision === null).length, 1);
});

test("untrusted cell text stays literal, never a formula, in all source metadata", async () => {
  const item = generateDemoRecords()[0];
  const payload = '=HYPERLINK("https://example.invalid","test")';
  const data = await exportDashboard([{ ...item, project: payload, documentNo: payload, scope: payload, sourceFile: payload }], { title: payload, source: payload });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(data as never);
  const dashboard = workbook.getWorksheet("REWORK KPI")!;
  const raw = workbook.getWorksheet("RAW TRANSACTIONS")!;
  assert.equal(dashboard.getCell("A1").value, payload);
  assert.equal(dashboard.getCell("A4").value, payload);
  assert.equal(raw.getCell("D2").value, payload);
  assert.equal(raw.getCell("K2").value, payload);
  assert.equal(raw.getCell("D2").type, ExcelJS.ValueType.String);
});
