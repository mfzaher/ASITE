import ExcelJS from "exceljs";
import { buildDashboard, HEADERS, KPI_NOTES, normalizeStatus, retainedRecords, summarize, type RegisterRecord } from "./dashboard";

export type ExportOptions = { title?: string; source?: string; warnings?: string[] };

const navy = "142A42", teal = "0B7A70", white = "FFFFFF", light = "F0F6F8";

/** ExcelJS writes literal strings as strings; it never receives untrusted formula objects. */
function literal(value: string): string {
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").slice(0, 32767);
}

export async function exportDashboard(records: RegisterRecord[], options: ExportOptions = {}): Promise<Uint8Array> {
  const filtered = retainedRecords(records);
  const rows = buildDashboard(filtered);
  const summary = summarize(filtered);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "E1 Drawing Dashboard";
  workbook.created = new Date();
  workbook.calcProperties.fullCalcOnLoad = true;
  const sheet = workbook.addWorksheet("REWORK KPI", { views: [{ state: "frozen", xSplit: 3, ySplit: 3 }] });
  sheet.mergeCells("A1:AC1");
  sheet.getCell("A1").value = literal(options.title || "E1 (SCHEDULES) — SHOP DRAWING REVISION DASHBOARD");
  sheet.getCell("A1").font = { bold: true, size: 16, color: { argb: white } };
  sheet.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: navy } };
  sheet.getCell("A1").alignment = { vertical: "middle" };
  sheet.getRow(1).height = 38;
  sheet.mergeCells("A2:AC2");
  sheet.getCell("A2").value = literal(`${options.source || "Selected E1 shop-drawing register rows"} • ${filtered.length} transaction rows • See NOTES for template definitions.`);
  sheet.getCell("A2").font = { size: 10, color: { argb: "54667A" } };
  sheet.getRow(2).height = 25;
  sheet.getRow(3).values = HEADERS;
  sheet.getRow(3).height = 66;
  sheet.getRow(3).eachCell((cell) => {
    cell.font = { bold: true, size: 10, color: { argb: white } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: teal } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  });
  sheet.getColumn(1).width = 20;
  sheet.getColumn(2).width = 35;
  sheet.getColumn(3).width = 48;
  for (let column = 4; column <= HEADERS.length; column++) sheet.getColumn(column).width = 17;
  rows.forEach((dashboard, index) => {
    const rowNumber = index + 4;
    const row = sheet.getRow(rowNumber);
    row.values = dashboard.values.map((value) => typeof value === "string" ? literal(value) : value);
    // Preserve the uploaded template's KPI expressions, with cached results for previews.
    const formulas: Record<number, string> = {
      19: `K${rowNumber}+L${rowNumber}`,
      20: `IFERROR(F${rowNumber}/E${rowNumber},0)`,
      21: `IFERROR(G${rowNumber}/F${rowNumber},0)`,
      22: `IFERROR(K${rowNumber}/E${rowNumber},0)`,
      23: `IFERROR(L${rowNumber}/(G${rowNumber}+L${rowNumber}),0)`,
      24: `IFERROR((R${rowNumber}/E${rowNumber})-1,0)`,
      25: `IFERROR(J${rowNumber}/R${rowNumber},0)`,
      26: `IFERROR(J${rowNumber}/E${rowNumber},0)`,
      27: `IFERROR(J${rowNumber}/R${rowNumber},0)`,
      28: `IFERROR((J${rowNumber}-F${rowNumber})/J${rowNumber},0)`,
    };
    for (const [column, formula] of Object.entries(formulas)) {
      row.getCell(Number(column)).value = { formula, result: dashboard.values[Number(column) - 1] as number };
    }
    row.height = 32;
    row.eachCell((cell, column) => {
      cell.font = { size: 10, color: { argb: navy } };
      cell.alignment = { vertical: "middle", horizontal: column <= 3 ? "left" : "center", wrapText: column <= 3 };
      if (index % 2 === 0) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: light } };
      cell.border = { bottom: { style: "hair", color: { argb: "DCE4EA" } } };
      cell.numFmt = column >= 20 && column <= 28 && column !== 26 ? "0.0%" : column === 26 ? "0.00" : "0";
    });
  });
  sheet.autoFilter = { from: "A3", to: `AC${Math.max(3, rows.length + 3)}` };
  sheet.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: "1:3" };

  const raw = workbook.addWorksheet("RAW TRANSACTIONS", { views: [{ state: "frozen", ySplit: 1 }] });
  raw.addRow(["Project", "Scope", "Dashboard Row", "Document No", "Discipline", "Package", "Revision", "Status", "Submission Date", "L/S", "Source File", "Sheet", "Source Row", "Record ID"]);
  filtered.forEach((record) => raw.addRow([
    literal(record.project), literal(record.scope), literal(record.dashboardRow), literal(record.documentNo),
    literal(record.discipline), literal(record.package), record.revision, literal(normalizeStatus(record.status)),
    record.submittedAt ? literal(record.submittedAt) : null, record.superseded ? "S" : "L",
    literal(record.sourceFile), literal(record.sheet), record.rowNumber, literal(record.id),
  ]));
  raw.getRow(1).height = 28;
  raw.getRow(1).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: white } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: navy } };
  });
  for (let column = 1; column <= 14; column++) raw.getColumn(column).width = [2, 3, 11, 14].includes(column) ? 42 : 23;
  raw.autoFilter = { from: "A1", to: `N${Math.max(1, filtered.length + 1)}` };

  const notes = workbook.addWorksheet("NOTES");
  notes.getColumn(1).width = 120;
  notes.addRow(["Calculation and source notes"]);
  notes.getCell("A1").font = { bold: true, size: 15, color: { argb: navy } };
  notes.addRow([literal(options.source || "Source: selected E1 (Schedules) shop-drawing registers.")]);
  notes.addRow([`Included transaction rows: ${summary.recordCount}; missing/unknown revisions: ${summary.unknownRevisions}; unknown statuses: ${summary.unknownStatuses}; pending/planned: ${summary.pending}.`]);
  if (options.warnings?.length) {
    notes.addRow(["Extraction warnings — review before sharing these totals"]);
    for (const warning of options.warnings) {
      const row = notes.addRow([literal(warning)]);
      row.height = 44;
      row.getCell(1).alignment = { wrapText: true, vertical: "middle" };
    }
  }
  for (const note of KPI_NOTES) {
    const row = notes.addRow([note]);
    row.height = 44;
    row.getCell(1).alignment = { wrapText: true, vertical: "middle" };
  }
  const result = await workbook.xlsx.writeBuffer();
  return new Uint8Array(result);
}
