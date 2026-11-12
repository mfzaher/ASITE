import test from "node:test";
import assert from "node:assert/strict";
import { WorkspaceStore } from "../src/lib/governance/store";
import { answerWorkspaceAssistant, scopeAssistantData } from "../src/lib/governance/assistant";
import { snapshot } from "../src/lib/governance/service";
import type { Actor } from "../src/lib/governance/types";
import { loadDemo } from "../src/lib/governance/demo";

const owner: Actor = {
  id: "owner", name: "Owner", email: "owner@example.invalid",
  grants: [{ entityId: "*", projectIds: ["*"], role: "admin" }],
};
const scoped: Actor = {
  id: "scoped", name: "Scoped", email: "viewer@example.invalid",
  grants: [{ entityId: "ecc", projectIds: ["j385"], role: "viewer" }],
};
function fixture() {
  const store = new WorkspaceStore(":memory:");
  store.save("entities", {
    id: "ecc", entityId: "ecc", name: "ECC", owner: "owner",
    entitlement: "unverified", entitlementReference: "",
  });
  for (const [id, code] of [["j385", "J385"], ["j386", "J386"]]) {
    store.save("projects", { id, entityId: "ecc", projectId: id, code, name: code, asiteWorkspaceId: "" });
  }
  return store;
}
function access(store: WorkspaceStore, project: string, name: string, days: string[], complete = true) {
  store.save("access", {
    id: project + "-" + name, entityId: "ecc", projectId: project,
    name, email: name + "@example.invalid", expected: true,
    licenceStatus: "unverified", lastActiveAt: days.at(-1) || "",
    activityDates: days, activityHistoryComplete: complete,
    sourceReference: "test-import",
  });
}

test("queries do not leak project data or permit cross-project selection", () => {
  const store = fixture();
  access(store, "j385", "member1", ["2026-10-18T10:00:00Z"]);
  access(store, "j386", "member2", ["2026-10-19T10:00:00Z"]);
  const scopedView = snapshot(store, scoped);
  const data = scopeAssistantData(scopedView, { query: "project overview", month: "2026-10" });
  assert.deepEqual(data.projects.map((p) => p.code), ["J385"]);
  assert.deepEqual(data.access.map((a) => a.name), ["member1"]);
  assert.throws(
    () => scopeAssistantData(scopedView, { query: "project overview", month: "2026-10", projectIds: ["j386"] }),
    /outside your access scope/,
  );
  store.close();
});

test("complete monthly activity uses distinct email counts and month boundaries", async () => {
  const store = fixture();
  access(store, "j385", "a", ["2026-09-28T21:00:00Z", "2026-10-18T10:00:00Z"]);
  access(store, "j385", "b", ["2026-09-30T19:59:59Z"]);
  access(store, "j386", "c", ["2026-10-19T10:00:00Z"]);
  const result = await answerWorkspaceAssistant(store, owner, snapshot(store, owner), {
    query: "Which project had the highest number of active users last month?",
    month: "2026-10",
  });
  assert.equal(result.status, "answered");
  assert.match(result.answer, /J385: 1 active of 2 assigned/);
  assert.match(result.answer, /J386: 1 active of 1 assigned/);
  assert.equal(result.citations.length, 2);
  store.close();
});

test("incomplete history cannot be mistaken for zero activity", async () => {
  const store = fixture();
  access(store, "j385", "a", ["2026-10-18T10:00:00Z"], false);
  const result = await answerWorkspaceAssistant(store, owner, snapshot(store, owner), {
    query: "active users",
    projectIds: ["j385"], month: "2026-10",
  });
  assert.equal(result.status, "unavailable");
  assert.match(result.answer, /Missing complete dated activity history/);
  store.close();
});

test("native ASITE approval KPIs stay unavailable without an approved feed", async () => {
  const store = fixture();
  const result = await answerWorkspaceAssistant(store, owner, snapshot(store, owner), {
    query: "What percentage of shop drawings were approved?",
    month: "2026-10",
  });
  assert.equal(result.status, "unavailable");
  assert.match(result.answer, /no verified native Asite document\/workflow feed/i);
  assert.equal(result.citations.length, 0);
  store.close();
});

test("demo data never creates real ECC metrics", async () => {
  const store = new WorkspaceStore(":memory:");
  loadDemo(store, owner, new Date("2026-10-19T10:00:00Z"));
  const result = await answerWorkspaceAssistant(store, owner, snapshot(store, owner), {
    query: "project overview", month: "2026-10",
  });
  assert.equal(result.status, "unavailable");
  assert.equal(result.citations.length, 0);
  store.close();
});

test("unknown reporting months are rejected", () => {
  const store = fixture();
  assert.throws(
    () => scopeAssistantData(snapshot(store, owner), { query: "access", month: "2026-99" }),
    /valid month/,
  );
  store.close();
});

test("project comparison reports missing imports as unknown rather than zero", async () => {
  const store = fixture();
  const result = await answerWorkspaceAssistant(store, owner, snapshot(store, owner), {
    query: "project overview", month: "2026-10",
  });
  assert.equal(result.status, "limited");
  assert.match(result.answer, /coverage unavailable/);
  assert.doesNotMatch(result.answer, /0 imported submissions/);
  store.close();
});
