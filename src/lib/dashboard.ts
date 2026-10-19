/** Register transactions, rather than latest-only document metadata, drive the template. */
export type RegisterRecord = {
  id: string;
  documentNo: string;
  project: string;
  scope: string;
  dashboardRow: string;
  discipline: string;
  package: string;
  revision: number | null;
  status: string;
  submittedAt: string | null;
  superseded: boolean;
  sourceFile: string;
  sheet: string;
  rowNumber: number;
};

export type DashboardRow = {
  project: string;
  scope: string;
  dashboardRow: string;
  values: (string | number)[];
};

/** Exact Book122.xlsx A3:AC3 labels, including its additional KPI columns. */
export const HEADERS = [
  "Project", "Scope", "Dashboard Row", "Total Planned", "Total submission Rev 0",
  "Rejected from Rev 0", "Rejected from Rev 1", "Rejected from Rev 2", "Rejected from Rev 3",
  "Total Rejection all revisions", "Approved from Rev 0", "Approved from Rev 1",
  "Approved from Rev 2", "Approved from Rev 3", "Approved from Rev 4", "Approved from Rev 5",
  "Total Approval all revisions", "Total submissions till approval", "Approved till Rev 1",
  "Rejection % from Rev 0 (Re-work)", "Rejection % from Rev 1 (Re-work)",
  "First-Time Approval %", "Approval % till Rev 1", "Consultant Rejection %",
  "Overall Rejection to Submission %", "Code C/D returns per drawing",
  "Rejection share of transactions %", "Repeat-rejection % (Rev>=1)", "Max revision reached",
];

export const KPI_NOTES = [
  "Only shop-drawing register rows from the selected E1 (Schedules) files are included; material submittals are excluded.",
  "A/B are approval codes; C/D are rejection codes. Pending and unknown statuses do not enter approval/rejection totals.",
  "Total Planned follows the supplied template: count register rows with document number and L/S marker other than S. This is not a distinct-document count.",
  "Total submission Rev 0 counts explicit numeric revision 0 rows with a valid submission date. Missing or nonnumeric revisions are never assumed to be revision 0.",
  "Total submissions till approval follows the supplied formula: all retained register transaction rows, including pending and planned rows. It does not stop at the first approval.",
  "Revision columns show rejections 0–3 and approvals 0–5. All-revision totals also include higher and unknown revisions; the displayed buckets may not add up to those totals.",
  "Approved till Rev 1 = K+L. Rejection % from Rev 0 = F/E. Rejection % from Rev 1 = G/F, as in the template (a ratio of revision-1 to revision-0 rejections).",
  "First-Time Approval % = K/E. Approval % till Rev 1 preserves the supplied formula L/(G+L): the approval share of revision-1 returns, not cumulative approvals through revision 1.",
  "Consultant Rejection % preserves the supplied formula R/E−1: extra transactions relative to revision-0 submissions, not the share of rejected returns. It can exceed 100% or be negative when register dates are incomplete.",
  "Overall Rejection to Submission % and Rejection share of transactions % both equal J/R. Code C/D returns per drawing = J/E. Repeat-rejection % = (J−F)/J; unknown revisions can enter this template-derived measure.",
  "Zero denominators produce zero to match IFERROR in the supplied template. Missing revisions and unknown status codes remain visible in RAW TRANSACTIONS for review.",
  "Repeated ingestion of the same provenance ID is counted once. Distinct source rows are retained even when document number and revision repeat, matching the register-row formula semantics.",
  "Count columns capture the filtered source rows at export time; KPI formulas recalculate within this workbook. No external workbook references or credentials are exported.",
];

export function normalizeStatus(value: string): string {
  const text = value.trim().replace(/\s+/g, " ").toUpperCase();
  const explicitCode = text.match(/^CODE\s+([ABCD])\b/);
  if (explicitCode) return explicitCode[1];
  const code = text.match(/^(?:CODE\s*)?([ABCD])(?:$|\s*[-:–—]\s*|\s*\()/);
  if (code) return code[1];
  if (/^(APPROVED|ACCEPTED)$/.test(text)) return "A";
  if (/^(APPROVED|ACCEPTED) (WITH|AS) (COMMENTS|NOTED|NOTES)$/.test(text)) return "B";
  if (/^(REVISE (AND|&) RESUBMIT|REVISED AND RESUBMIT|RESUBMIT|REVISE & RE-SUBMIT)$/.test(text)) return "C";
  if (/^(REJECTED|NOT APPROVED|NOT ACCEPTED)$/.test(text)) return "D";
  if (/^(PENDING|UNDER REVIEW|IN REVIEW|SUBMITTED|AWAITING REVIEW|AWAITING APPROVAL)$/.test(text)) return "PENDING";
  return text;
}

export function isApproval(status: string): boolean { return ["A", "B"].includes(normalizeStatus(status)); }
export function isRejection(status: string): boolean { return ["C", "D"].includes(normalizeStatus(status)); }
export function classifyStatus(status: string): "approved" | "rejected" | "pending" | "unknown" {
  const normalized = normalizeStatus(status);
  if (isApproval(normalized)) return "approved";
  if (isRejection(normalized)) return "rejected";
  return !normalized || normalized === "PENDING" ? "pending" : "unknown";
}

/** Deduplicate ingestion, not repeat submissions. Filter cancelled/material rows defensively. */
export function retainedRecords(records: RegisterRecord[]): RegisterRecord[] {
  const seen = new Set<string>();
  return records.filter((record) => {
    if (!record.documentNo.trim()) return false;
    if (/\b(CANCELLED|CANCELED|WITHDRAWN|VOID|DELETED)\b/i.test(record.status)) return false;
    if (/\bmaterial(?:s| submittals?)?\b/i.test(`${record.sheet} ${record.dashboardRow}`)) return false;
    const key = record.id || JSON.stringify([record.sourceFile, record.sheet, record.rowNumber, record.documentNo]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const divide = (numerator: number, denominator: number) => denominator === 0 ? 0 : numerator / denominator;

function metrics(records: RegisterRecord[]) {
  const rejected = [0, 0, 0, 0];
  const approved = [0, 0, 0, 0, 0, 0];
  let planned = 0, rev0Submissions = 0, approvals = 0, rejections = 0;
  let maxRevision = 0, unknownStatuses = 0, pending = 0, unknownRevisions = 0;
  for (const record of records) {
    const status = normalizeStatus(record.status);
    const validRevision = record.revision !== null && Number.isInteger(record.revision) && record.revision >= 0;
    if (!record.superseded) planned++;
    if (record.revision === 0 && record.submittedAt && Number.isFinite(Date.parse(record.submittedAt))) rev0Submissions++;
    if (validRevision) maxRevision = Math.max(maxRevision, record.revision!);
    else unknownRevisions++;
    if (isApproval(status)) {
      approvals++;
      if (validRevision && record.revision! <= 5) approved[record.revision!]++;
    } else if (isRejection(status)) {
      rejections++;
      if (validRevision && record.revision! <= 3) rejected[record.revision!]++;
    } else if (!status || status === "PENDING") pending++;
    else unknownStatuses++;
  }
  return { recordCount: records.length, planned, rev0Submissions, approvals, rejections,
    firstTimeApprovalRate: divide(approved[0], rev0Submissions), maxRevision, unknownStatuses,
    pending, unknownRevisions, rejected, approved };
}

export function summarize(records: RegisterRecord[]) {
  return metrics(retainedRecords(records));
}

export function buildDashboard(records: RegisterRecord[]): DashboardRow[] {
  const groups = new Map<string, RegisterRecord[]>();
  for (const record of retainedRecords(records)) {
    const key = JSON.stringify([record.project, record.scope, record.dashboardRow]);
    const group = groups.get(key);
    if (group) group.push(record);
    else groups.set(key, [record]);
  }
  return [...groups.values()].map((group): DashboardRow => {
    const { project, scope, dashboardRow } = group[0];
    const m = metrics(group);
    const [f, g] = m.rejected;
    const [k, l] = m.approved;
    return { project, scope, dashboardRow, values: [
      project, scope, dashboardRow, m.planned, m.rev0Submissions, ...m.rejected, m.rejections,
      ...m.approved, m.approvals, m.recordCount, k + l, divide(f, m.rev0Submissions),
      divide(g, f), divide(k, m.rev0Submissions), divide(l, g + l),
      m.rev0Submissions ? (m.recordCount / m.rev0Submissions) - 1 : 0,
      divide(m.rejections, m.recordCount), divide(m.rejections, m.rev0Submissions),
      divide(m.rejections, m.recordCount), divide(m.rejections - f, m.rejections), m.maxRevision,
    ] };
  }).sort((a, b) => `${a.project}\0${a.dashboardRow}\0${a.scope}`.localeCompare(`${b.project}\0${b.dashboardRow}\0${b.scope}`));
}

/** Entirely fictional examples; never copied from the user's workbook. */
export function generateDemoRecords(): RegisterRecord[] {
  const specifications: [string, string, string, (number | null)[], string[]][] = [
    ["STR", "FOUNDATION", "Shop Drawing Submittals (ECC Str GA)", [0, 1, 0, 0, 0], ["C", "B", "A", "PENDING", ""]],
    ["ARCH", "GENERAL ARRANGEMENT (GA)", "Shop Drawing Submittals (ECC Arch In-House)", [0, 1, 2, 0, 0], ["D", "C", "A", "B", "PENDING"]],
    ["MEP", "HVAC", "Shop Drawing Submittals (MEP)", [0, 1, 2, 3, 4, 5, 6, null], ["C", "C", "D", "C", "C", "D", "A", "UNMAPPED"]],
    ["MEP", "FIRE ALARM", "Shop Drawing Submittals (MEP)", [0, 0, 0, 1], ["A", "B", "D", "B"]],
  ];
  let index = 0;
  return specifications.flatMap(([discipline, scope, dashboardRow, revisions, statuses]) => revisions.map((revision, offset) => {
    const rowNumber = ++index + 14;
    const isHistory = offset > 0 && (discipline === "MEP" && scope === "HVAC" || discipline === "ARCH" && offset < 3 || discipline === "STR" && offset === 1);
    const documentNo = `DEMO-${discipline}-${isHistory ? "001" : String(offset + 1).padStart(3, "0")}`;
    return { id: `demo-${index}`, documentNo, project: "DEMO PROJECT", scope, dashboardRow, discipline,
      package: "DEMO PACKAGE", revision, status: statuses[offset], submittedAt: statuses[offset] ? `2026-01-${String(index + 1).padStart(2, "0")}T00:00:00.000Z` : null,
      superseded: isHistory && revision !== revisions[revisions.length - 1], sourceFile: "Synthetic E1 Shop Drawing Schedule.xlsx", sheet: discipline, rowNumber };
  }));
}
