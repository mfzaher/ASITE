/** Check XLSX ZIP metadata before ExcelJS allocates decompressed worksheets. */
export function validateXlsxArchive(input: ArrayBuffer | Uint8Array): void {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const invalid = () => new Error("This file has invalid or unsupported XLSX archive metadata. Export a fresh .xlsx register and try again.");
  if (bytes.length < 22) throw invalid();
  let end = -1;
  // The ZIP comment is at most 65,535 bytes; EOCD must end at the actual file end.
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 22 - 65535); offset--) {
    if (view.getUint32(offset, true) === 0x06054b50 && offset + 22 + view.getUint16(offset + 20, true) === bytes.length) { end = offset; break; }
  }
  if (end < 0) throw invalid();
  if (end >= 20 && view.getUint32(end - 20, true) === 0x07064b50) throw new Error("ZIP64 workbooks are unsupported; split or re-export the register as a standard .xlsx file.");
  const disk = view.getUint16(end + 4, true), directoryDisk = view.getUint16(end + 6, true);
  const diskEntries = view.getUint16(end + 8, true), entries = view.getUint16(end + 10, true);
  const directorySize = view.getUint32(end + 12, true), directoryOffset = view.getUint32(end + 16, true);
  if (entries === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) throw new Error("ZIP64 workbooks are unsupported; split or re-export the register as a standard .xlsx file.");
  if (disk !== 0 || directoryDisk !== 0 || diskEntries !== entries) throw invalid();
  if (entries > 10000) throw new Error("This workbook contains more than 10,000 archive entries; split the register before importing.");
  if (entries === 0 || directoryOffset + directorySize > end) throw invalid();
  const directoryEnd = directoryOffset + directorySize;
  let cursor = directoryOffset, totalUncompressed = 0;
  const names = new Set<string>();
  const decoder = new TextDecoder();
  for (let entry = 0; entry < entries; entry++) {
    if (cursor + 46 > directoryEnd || view.getUint32(cursor, true) !== 0x02014b50) throw invalid();
    const flags = view.getUint16(cursor + 8, true), compression = view.getUint16(cursor + 10, true);
    const compressed = view.getUint32(cursor + 20, true), uncompressed = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true), extraLength = view.getUint16(cursor + 30, true), commentLength = view.getUint16(cursor + 32, true);
    const entryDisk = view.getUint16(cursor + 34, true), localOffset = view.getUint32(cursor + 42, true);
    if (compressed === 0xffffffff || uncompressed === 0xffffffff || localOffset === 0xffffffff || entryDisk === 0xffff) throw new Error("ZIP64 workbooks are unsupported; split or re-export the register as a standard .xlsx file.");
    if ((flags & 1) !== 0) throw new Error("Encrypted workbooks cannot be imported. Export an unencrypted shop-drawing register.");
    if (entryDisk !== 0 || ![0, 8].includes(compression) || cursor + 46 + nameLength + extraLength + commentLength > directoryEnd) throw invalid();
    const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    if (!name || names.has(name)) throw invalid();
    names.add(name);
    // Local header must point to a bounded member, rather than the directory or past EOF.
    if (localOffset + 30 > directoryOffset || view.getUint32(localOffset, true) !== 0x04034b50) throw invalid();
    const localNameLength = view.getUint16(localOffset + 26, true), localExtraLength = view.getUint16(localOffset + 28, true);
    if (localOffset + 30 + localNameLength + localExtraLength + compressed > directoryOffset) throw invalid();
    totalUncompressed += uncompressed;
    if (totalUncompressed > 100 * 1024 * 1024) throw new Error("This workbook expands beyond the 100 MB import limit; split the register by discipline.");
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  if (cursor !== directoryEnd || !names.has("[Content_Types].xml") || !names.has("xl/workbook.xml")) throw invalid();
}
