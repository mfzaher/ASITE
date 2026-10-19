import assert from "node:assert/strict";
import test from "node:test";
import { buildDashboard, classifyStatus, HEADERS, normalizeStatus, summarize, type RegisterRecord } from "../src/lib/dashboard";

const record = (id: string, overrides: Partial<RegisterRecord> = {}): RegisterRecord => ({
  id, documentNo: "SD-001", project: "Test project", scope: "FOUNDATION", dashboardRow: "Shop Drawing Submittals (ECC Str GA)",
  discipline: "STR", package: "P-test", revision: 0, status: "A", submittedAt: "2026-01-01T00:00:00.000Z",
  superseded: false, sourceFile: "test.xlsx", sheet: "STR", rowNumber: 15, ...overrides,
});

test("matches 29 source headers and counts row transactions, dated rev0 and high/unknown revisions", () => {
  const records = [
    record("1", { status: "C", superseded: true }),
    record("2", { revision: 1, status: "B" }),
    record("3", { status: "A" }),
    record("4", { status: "PENDING", submittedAt: null }),
    record("5", { revision: 7, status: "D" }),
    record("6", { revision: 8, status: "A" }),
    record("7", { revision: null, status: "C" }),
    record("8", { revision: null, status: "UNRECOGNIZED" }),
  ];
  const [dashboard] = buildDashboard(records);
  assert.equal(HEADERS.length, 29);
  assert.equal(dashboard.values.length, 29);
  assert.deepEqual(dashboard.values.slice(3, 19), [7, 2, 1, 0, 0, 0, 3, 1, 1, 0, 0, 0, 0, 3, 8, 2]);
  assert.equal(dashboard.values[19], 0.5);
  assert.equal(dashboard.values[21], 0.5);
  assert.equal(dashboard.values[22], 1);
  assert.equal(dashboard.values[23], 3);
  assert.equal(dashboard.values[28], 8);
  const summary = summarize(records);
  assert.equal(summary.unknownRevisions, 2);
  assert.equal(summary.unknownStatuses, 1);
  assert.equal(summary.pending, 1);
});

test("deduplicates provenance only, retains genuine repeated rows and removes cancelled/material rows", () => {
  const item = record("same");
  const records = [item, item, record("distinct"), record("cancelled", { status: "Cancelled" }),
    record("material", { dashboardRow: "Material Submittals (ECC)" }), record("empty", { documentNo: " " })];
  assert.equal(summarize(records).recordCount, 2);
  assert.equal(summarize(records).approvals, 2);
});

test("zero denominators stay finite and revision zero cannot be inferred from missing metadata", () => {
  const [dashboard] = buildDashboard([record("unknown", { revision: null, submittedAt: null, status: "D" })]);
  assert.equal(dashboard.values[4], 0);
  assert.equal(dashboard.values[5], 0);
  assert.equal(dashboard.values[9], 1);
  dashboard.values.slice(19).forEach((value) => assert.ok(Number.isFinite(value)));
});

test("status mapping uses explicit codes or known labels without prefix guesses", () => {
  assert.equal(normalizeStatus("Code A - Approved"), "A");
  assert.equal(normalizeStatus("B - Approved with comments"), "B");
  assert.equal(normalizeStatus("Approved with comments"), "B");
  assert.equal(normalizeStatus("Revise and resubmit"), "C");
  assert.equal(classifyStatus("Rejected"), "rejected");
  assert.equal(classifyStatus("Under review"), "pending");
  assert.equal(classifyStatus("BMS coordination"), "unknown");
  assert.equal(classifyStatus("Awaiting information"), "unknown");
});

test("groups projects and scope mappings independently", () => {
  const rows = buildDashboard([record("p1"), record("p2", { project: "Other project" }), record("a", { scope: "FORMWORK", dashboardRow: "Shop Drawing Submittals (OTHERS)" })]);
  assert.equal(rows.length, 3);
  assert.equal(rows.reduce((sum, row) => sum + Number(row.values[17]), 0), 3);
});
