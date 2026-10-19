import ExcelJS from "exceljs";
import { normalizeStatus, type RegisterRecord } from "./dashboard";
import { isExplicitNonShopFile } from "./folder-rules";
import { validateXlsxArchive } from "./xlsx-safety";

export type RegisterContext = { sourceFile: string; project: string; package?: string };
export type RegisterParseResult = { records: RegisterRecord[]; warnings: string[] };

type Field = "documentNo" | "scope" | "revision" | "marker" | "status" | "submittedAt" | "project" | "package" | "discipline" | "dashboardRow" | "documentType";
type Columns = Partial<Record<Field, number>>;

const aliases: Record<Field, string[]> = {
  documentNo: ["documentno", "documentnumber", "docno", "docnumber", "drawingno", "drawingnumber", "documentreference", "drawingreference", "documentid"],
  scope: ["scope", "workscope", "category", "works", "trade", "subdiscipline"],
  revision: ["rev", "revision", "revno", "revisionno", "revisionnumber", "currentrevision"],
  marker: ["ls", "latestsuperseded", "latestsupersededstatus", "superseded", "supersededstatus"],
  status: ["status", "statuscode", "approvalstatus", "reviewstatus", "consultantstatus", "consultantstatuscode", "returncode", "code", "responsecode", "revisionstatus"],
  submittedAt: ["submittedat", "submissiondate", "submitteddate", "dateofsubmission", "datesubmitted", "actualsubmissiondate", "submittedon"],
  project: ["project", "projectname", "projectcode"],
  package: ["package", "packagename", "packagecode"],
  discipline: ["discipline"],
  dashboardRow: ["dashboardrow"],
  documentType: ["documenttype", "drawingtype", "type", "submittaltype"],
};

const structuralGA = ["BLOCK WORK LAYOUT", "CONSTRUCTION JOINT", "DEWATERING", "FORMATION LEVEL & POST TENSION", "FOUNDATION", "PILE CUT-OFF", "SITE LOGISTICS", "STAIRCASE", "STR-GA", "TOWER CRANE"];
const architecturalGA = ["GENERAL ARRANGEMENT (GA)", "MOCK-UP (ARCH)", "RCP", "SETTING OUT & PARKING", "STAIRCASE", "TILE"];
const scopeMappings: Record<string, Record<string, string>> = {
  STR: {
    ...Object.fromEntries(structuralGA.map((scope) => [scope, "Shop Drawing Submittals (ECC Str GA)"])),
    "FORMWORK": "Shop Drawing Submittals (OTHERS)",
    "PMI/ STEEL PLATE": "Shop Drawing Submittals (STR STEEL)",
    "REBAR / REINFORCEMENT": "Shop Drawing Submittals (ECC Str Rebar)",
    "WATERPROOFING": "Shop Drawing Submittals (Waterproofing)",
  },
  ARCH: {
    ...Object.fromEntries(architecturalGA.map((scope) => [scope, "Shop Drawing Submittals (ECC Arch In-House)"])),
    "ABANOS": "Shop Drawing Submittals (JOINERY & FITOUT)",
    "LIFTS": "Shop Drawing Submittals (OTHERS)", "TKE ELEVATOR": "Shop Drawing Submittals (OTHERS)",
    "MOCK-UP (PMI ALUMINIUM)": "Shop Drawing Submittals (ALUMINUM)",
    "PMI": "Shop Drawing Submittals (ALUMINUM)", "PODS (ECC)": "Shop Drawing Submittals (PODS)",
  },
};

const headerKey = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, "");
const scopeKey = (text: string) => text.trim().replace(/\s+/g, " ").toUpperCase();

function cellValue(cell: ExcelJS.Cell): string | number | Date | boolean | null {
  const value = cell.value;
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value instanceof Date) return value;
  if ("formula" in value || "sharedFormula" in value) {
    // ExcelJS's .value getter omits a cached numeric zero; .result retains it.
    const result = cell.result;
    return typeof result === "string" || typeof result === "number" || typeof result === "boolean" || result instanceof Date ? result : null;
  }
  if ("richText" in value) return value.richText.map((part) => part.text).join("");
  if ("text" in value) return value.text;
  return null;
}

function text(cell: ExcelJS.Cell): string {
  const value = cellValue(cell);
  return value === null ? "" : value instanceof Date ? Number.isFinite(value.getTime()) ? value.toISOString() : "" : String(value).trim();
}

export function parseRevision(value: unknown): number | null {
  if (typeof value === "number") return Number.isInteger(value) && value >= 0 && value <= 10000 ? value : null;
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^(?:(?:REV(?:ISION)?|R)\s*[.:#-]?\s*)?(\d+)$/i);
  if (!match) return null;
  const revision = Number(match[1]);
  return Number.isSafeInteger(revision) && revision <= 10000 ? revision : null;
}

function submissionDate(value: unknown, date1904: boolean): string | null {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : null;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0 || value > 2958465) return null;
    const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
    const date = new Date(epoch + value * 86400000);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  }
  if (typeof value !== "string" || !value.trim()) return null;
  const source = value.trim();
  if (/^\d{4}-\d{2}-\d{2}(?:T.*|\s.*)?$/.test(source)) {
    const year = Number(source.slice(0, 4)), month = Number(source.slice(5, 7)), day = Number(source.slice(8, 10));
    const calendarDate = new Date(Date.UTC(year, month - 1, day));
    if (calendarDate.getUTCFullYear() !== year || calendarDate.getUTCMonth() !== month - 1 || calendarDate.getUTCDate() !== day) return null;
    const parsed = new Date(source.length === 10 ? `${source}T00:00:00.000Z` : source);
    return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
  }
  const dayFirst = source.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/);
  if (dayFirst) {
    const day = Number(dayFirst[1]), month = Number(dayFirst[2]), year = Number(dayFirst[3]);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day) return parsed.toISOString();
  }
  return null;
}

function inferDiscipline(value: string): string {
  if (/^(STR|STRUCTURAL)(?:\b|[_-])/i.test(value)) return "STR";
  if (/^(ARCH|ARCHITECTUR(?:AL|E))(?:\b|[_-])/i.test(value)) return "ARCH";
  if (/^(MEP|MECHANICAL|ELECTRICAL|PLUMBING)(?:\b|[_-])/i.test(value)) return "MEP";
  return value.trim().toUpperCase() || "OTHER";
}

function dashboardLabel(scope: string, discipline: string): string {
  const key = scopeKey(scope);
  if (discipline === "MEP") return key === "MEP PODS" ? "Shop Drawing Submittals (PODS)" : "Shop Drawing Submittals (MEP)";
  return scopeMappings[discipline]?.[key] ?? `Shop Drawing Submittals (${discipline === "OTHER" ? "Unmapped" : discipline})`;
}

function headerColumns(row: ExcelJS.Row): Columns {
  const columns: Columns = {};
  row.eachCell((cell, columnNumber) => {
    const key = headerKey(text(cell));
    for (const [field, names] of Object.entries(aliases)) {
      if (names.includes(key) && !columns[field as Field]) columns[field as Field] = columnNumber;
    }
  });
  return columns;
}

export async function parseRegister(buffer: ArrayBuffer | Uint8Array, context: RegisterContext): Promise<RegisterParseResult> {
  const basename = context.sourceFile.split(/[\\/]/).at(-1) || context.sourceFile;
  if (isExplicitNonShopFile(basename)) return { records: [], warnings: [`${basename}: explicit E2/material register excluded; only E1 shop drawings are included.`] };
  if (buffer.byteLength > 25 * 1024 * 1024) throw new Error("Register files must be no larger than 25 MB.");
  validateXlsxArchive(buffer);
  const workbook = new ExcelJS.Workbook();
  try { await workbook.xlsx.load(buffer as never); }
  catch { throw new Error("This file could not be read as an .xlsx workbook. Export the original E1 shop-drawing register as .xlsx and try again."); }
  if (workbook.worksheets.length > 40) throw new Error("This workbook exceeds the supported limit of 40 sheets; split the register by discipline.");
  const records: RegisterRecord[] = [], warnings: string[] = [];
  const date1904 = Boolean(workbook.properties.date1904);
  let dashboardOnly = false;
  for (const sheet of workbook.worksheets) {
    if (isExplicitNonShopFile(sheet.name)) {
      warnings.push(`${sheet.name}: explicit E2/material submittals excluded.`);
      continue;
    }
    if (sheet.rowCount > 50000 || sheet.columnCount > 200) throw new Error(`${sheet.name}: register exceeds 50,000 rows or 200 columns; split the file to avoid a partial dashboard.`);
    let columns: Columns | null = null, firstDataRow = 0;
    let isDashboard = false;
    for (let rowNumber = 1; rowNumber <= Math.min(40, sheet.rowCount); rowNumber++) {
      const row = sheet.getRow(rowNumber);
      const keys: string[] = [];
      row.eachCell((cell) => keys.push(headerKey(text(cell))));
      if (keys.includes("dashboardrow") && keys.includes("totalplanned") && keys.includes("totalsubmissionrev0")) {
        isDashboard = true; dashboardOnly = true; break;
      }
      const found = headerColumns(row);
      if (found.documentNo && found.revision && found.status) { columns = found; firstDataRow = rowNumber + 1; break; }
    }
    if (isDashboard) {
      warnings.push(`${sheet.name}: KPI summary skipped. It contains aggregate/external-reference formulas, not the source register transactions.`);
      continue;
    }
    const disciplineFromSheet = inferDiscipline(sheet.name);
    if (!columns && ["STR", "ARCH", "MEP"].includes(sheet.name.trim().toUpperCase()) && sheet.rowCount >= 15) {
      columns = { documentNo: 2, scope: 4, revision: 7, marker: 8, status: 13, submittedAt: 14 };
      firstDataRow = 15;
      warnings.push(`${sheet.name}: using the documented classic register layout B/D/G/H/M/N, beginning at row 15.`);
    }
    if (!columns) {
      if (sheet.actualRowCount) warnings.push(`${sheet.name}: no recognized shop-drawing register headers; sheet skipped. Expected Document/Drawing No, Revision, and Status.`);
      continue;
    }
    if (!columns.scope) warnings.push(`${sheet.name}: no Scope column; these rows appear under Unspecified scope.`);
    if (!columns.marker) warnings.push(`${sheet.name}: no L/S or Superseded column; Total Planned includes all retained rows because superseded transactions cannot be distinguished.`);
    const counts = { invalidRevision: 0, unknownStatus: 0, invalidDate: 0, cancelled: 0, material: 0, unmappedScope: 0 };
    for (let rowNumber = firstDataRow; rowNumber <= sheet.rowCount; rowNumber++) {
      const row = sheet.getRow(rowNumber);
      const get = (field: Field) => columns![field] ? text(row.getCell(columns![field]!)) : "";
      const documentNo = get("documentNo");
      if (!documentNo || aliases.documentNo.includes(headerKey(documentNo)) || /^(TOTAL|SUBTOTAL|GRAND TOTAL)$/i.test(documentNo)) continue;
      const status = normalizeStatus(get("status"));
      if (/\b(CANCELLED|CANCELED|WITHDRAWN|VOID|DELETED)\b/i.test(status)) { counts.cancelled++; continue; }
      const scope = get("scope") || "Unspecified scope";
      const providedLabel = get("dashboardRow");
      const documentType = get("documentType");
      if (isExplicitNonShopFile(providedLabel) || isExplicitNonShopFile(documentType) || /^(MATERIAL|MATERIALS)(?:\s|$)/i.test(scope)) { counts.material++; continue; }
      if (documentType && !/shop\s*drawings?|^SD$|^drawing$/i.test(documentType)) { counts.material++; continue; }
      const revision = parseRevision(columns.revision ? cellValue(row.getCell(columns.revision)) : null);
      if (revision === null) counts.invalidRevision++;
      if (status && !["A", "B", "C", "D", "PENDING"].includes(status)) counts.unknownStatus++;
      const rawDate = columns.submittedAt ? cellValue(row.getCell(columns.submittedAt)) : null;
      const submittedAt = submissionDate(rawDate, date1904);
      if (rawDate !== null && rawDate !== "" && rawDate !== 0 && !submittedAt) counts.invalidDate++;
      const discipline = get("discipline") ? inferDiscipline(get("discipline")) : ["STR", "ARCH", "MEP"].includes(disciplineFromSheet) ? disciplineFromSheet : "OTHER";
      const dashboardRow = /^Shop Drawing/i.test(providedLabel) ? providedLabel : dashboardLabel(scope, discipline);
      if (dashboardRow.endsWith("(Unmapped)") || dashboardRow === "Shop Drawing Submittals (STR)" || dashboardRow === "Shop Drawing Submittals (ARCH)") counts.unmappedScope++;
      records.push({ id: JSON.stringify([context.project, context.package || "", context.sourceFile, sheet.name, rowNumber]), documentNo,
        project: context.project || get("project") || "Unspecified project", scope, dashboardRow, discipline,
        package: context.package || get("package"), revision, status, submittedAt,
        superseded: /^(S|YES|TRUE|1|SUPERSEDED)$/i.test(get("marker")),
        sourceFile: context.sourceFile, sheet: sheet.name, rowNumber });
    }
    if (counts.invalidRevision) warnings.push(`${sheet.name}: ${counts.invalidRevision} rows have missing or unrecognized revisions; retained in totals, omitted from numeric revision buckets.`);
    if (counts.unknownStatus) warnings.push(`${sheet.name}: ${counts.unknownStatus} rows have unknown status codes; retained in transactions, omitted from approval/rejection totals.`);
    if (counts.invalidDate) warnings.push(`${sheet.name}: ${counts.invalidDate} unrecognized submission dates; those rows do not count as dated Rev 0 submissions. Supported text dates: YYYY-MM-DD or DD/MM/YYYY.`);
    if (counts.cancelled) warnings.push(`${sheet.name}: ${counts.cancelled} cancelled/withdrawn rows excluded.`);
    if (counts.material) warnings.push(`${sheet.name}: ${counts.material} explicit E2/material or other non-shop-drawing rows excluded.`);
    if (counts.unmappedScope) warnings.push(`${sheet.name}: ${counts.unmappedScope} rows use a scope outside the template mapping; retained in a discipline-level shop-drawing category.`);
  }
  if (!records.length) warnings.push(dashboardOnly
    ? "This workbook is a dashboard template, not a register. Its referenced STR/ARCH/MEP source sheets are not embedded. Use the original shop-drawing registers from E1 (Schedules); the dashboard layout is already built into this app."
    : "No shop-drawing register rows were found. Check that this is an E1 source register with document number, revision, and status columns.");
  return { records, warnings };
}
