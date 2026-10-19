/** User-provided project labels are display codes, not Asite's encrypted workspace IDs. */
export const PROJECT_FOLDER_RULES: Record<string, string[]> = {
  "377": ["05.08 E1 Schedule"],
  "378": ["05.08 E1 Schedule(SD)"],
  "379": ["05.08 E1 and E2 Schedules"],
  "381": ["05.08.01 E1_Schedule"],
  "382": ["05.08.01 E1_Schedule"],
  "383": ["05.08.01 E1_Schedule"],
  "384": ["09.02B E1_Schedule (Drawing Sheet)"],
  "385": ["09.02.03.02 (E1) - Shop Drawing Sheet", "09.03.03.02 (E1) - Shop Drawing Sheet", "09.04.03.02 (E1) - Shop Drawing Sheet", "09.05.03.02 (E1) - Shop Drawing Sheet"],
  "386": ["09.02.03.02 (E1) - Shop Drawing Sheet", "09.03.03.02 (E1) - Shop Drawing Sheet", "09.04.03.02 (E1) - Shop Drawing Sheet", "09.05.03.02 (E1) - Shop Drawing Sheet"],
  "388": ["09.03.02 (EI) - Shop Drawing Sheet"]
};
const normalize = (label: string) => label.trim().toLowerCase().replace(/\s+/g, " ");
export function projectDisplayCode(projectName: string): string | undefined {
  return Object.keys(PROJECT_FOLDER_RULES).find(code => new RegExp(`(?:^|[^a-z0-9])j?${code}(?:$|[^0-9])`, "i").test(projectName));
}
export function isE1FolderName(label: string, projectName?: string): boolean {
  const normalized = normalize(label);
  // EI is accepted only for the exact user-specified drawing-sheet folder.
  const namedAlias = PROJECT_FOLDER_RULES["388"].some(name => normalize(name) === normalized);
  if (namedAlias && (!projectName || projectDisplayCode(projectName) === "388")) return true;
  return /(^|[^a-z0-9])e1(?=$|[^a-z0-9])/i.test(label);
}
export function isExplicitNonShopFile(name: string): boolean {
  return /(?:^|[^a-z0-9])e2(?:$|[^a-z0-9])/i.test(name) && !/(?:^|[^a-z0-9])e1(?:$|[^a-z0-9])/i.test(name) || /\bmaterial(?:s|[ _-]*submittals?)\b/i.test(name);
}
