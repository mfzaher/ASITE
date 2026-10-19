import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import { validateXlsxArchive } from "../src/lib/xlsx-safety";

async function workbookBytes() {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet("STR").addRow(["Document No", "Revision", "Status"]);
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

function directoryOffsets(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end--;
  assert.ok(end >= 0);
  return { view, end, directory: view.getUint32(end + 16, true) };
}

test("accepts a standard XLSX and an offset Uint8Array without decompressing it", async () => {
  const bytes = await workbookBytes();
  assert.doesNotThrow(() => validateXlsxArchive(bytes));
  const padded = new Uint8Array(bytes.length + 30);
  padded.set(bytes, 15);
  assert.doesNotThrow(() => validateXlsxArchive(padded.subarray(15, 15 + bytes.length)));
});

test("rejects oversized declared expansion before workbook load", async () => {
  const bytes = await workbookBytes();
  const { view, directory } = directoryOffsets(bytes);
  view.setUint32(directory + 24, 101 * 1024 * 1024, true);
  assert.throws(() => validateXlsxArchive(bytes), /100 MB/);
});

test("rejects ZIP64, too many members, encrypted members, and invalid directory offsets", async () => {
  const original = await workbookBytes();
  let bytes = original.slice();
  let metadata = directoryOffsets(bytes);
  metadata.view.setUint16(metadata.end + 10, 0xffff, true);
  assert.throws(() => validateXlsxArchive(bytes), /ZIP64/);
  bytes = original.slice(); metadata = directoryOffsets(bytes);
  metadata.view.setUint16(metadata.end + 8, 10001, true);
  metadata.view.setUint16(metadata.end + 10, 10001, true);
  assert.throws(() => validateXlsxArchive(bytes), /10,000/);
  bytes = original.slice(); metadata = directoryOffsets(bytes);
  metadata.view.setUint16(metadata.directory + 8, 1, true);
  assert.throws(() => validateXlsxArchive(bytes), /Encrypted/);
  bytes = original.slice(); metadata = directoryOffsets(bytes);
  metadata.view.setUint32(metadata.end + 16, bytes.length + 10, true);
  assert.throws(() => validateXlsxArchive(bytes), /invalid or unsupported/);
});
