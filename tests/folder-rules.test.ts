import test from "node:test";
import assert from "node:assert/strict";
import { isE1FolderName, PROJECT_FOLDER_RULES, isExplicitNonShopFile, projectDisplayCode } from "../src/lib/folder-rules";
test("all supplied folder names including project 388 EI are matched, but E10 is excluded", () => {
  for (const [code, names] of Object.entries(PROJECT_FOLDER_RULES)) for (const name of names) assert.ok(isE1FolderName(name, `J${code} Project`), name);
  assert.equal(isE1FolderName("E10 Schedules"), false);
  assert.equal(isE1FolderName("EI other sheets"), false);
  assert.equal(projectDisplayCode("J388 Example Project"), "388");
});
test("mixed E1/E2 folder is allowed while explicit E2/material files are excluded", () => {
  assert.ok(isE1FolderName("05.08 E1 and E2 Schedules"));
  assert.ok(isExplicitNonShopFile("E2 Material Register.xlsx"));
  assert.ok(!isExplicitNonShopFile("E1 Shop Drawing Register.xlsx"));
});
