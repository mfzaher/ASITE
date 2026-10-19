import test from "node:test";
import assert from "node:assert/strict";
import { WorkspaceStore } from "../src/lib/governance/store";
import { loadDemo } from "../src/lib/governance/demo";
import {
  defaultRules,
  inAuditMonth,
  may,
  monthBounds,
  previousMonth,
  rulesFor,
  validateGate,
  workspaceMetrics,
} from "../src/lib/governance/engine";
import {
  approveLesson,
  approveRules,
  evidencePack,
  importRecords,
  linkRisk,
  reviewSubmission,
  runAudits,
  saveAccess,
  saveLesson,
  saveRules,
  saveSubmission,
  snapshot,
  sourceUrl,
  submitSubmission,
  transitionFinding,
} from "../src/lib/governance/service";
import { answerQuestion, retrieve } from "../src/lib/governance/retrieval";
import type { Actor } from "../src/lib/governance/types";

const now = new Date("2026-10-19T10:00:00Z");
const owner: Actor = {
  id: "local-owner",
  name: "M. Zaher",
  email: "owner@example.invalid",
  grants: [{ entityId: "*", projectIds: ["*"], role: "admin" }],
};
const reviewer: Actor = {
  id: "reviewer",
  name: "Reviewer",
  email: "reviewer@example.invalid",
  grants: [{ entityId: "demo-entity-1", projectIds: ["*"], role: "reviewer" }],
};
const viewer: Actor = {
  id: "viewer",
  name: "Scoped viewer",
  email: "viewer@example.invalid",
  grants: [
    {
      entityId: "demo-entity-1",
      projectIds: ["demo-project-1"],
      role: "viewer",
    },
  ],
};
function fixture() {
  const s = new WorkspaceStore(":memory:");
  loadDemo(s, owner, now);
  return s;
}
function validSubmission(extra: Record<string, unknown> = {}) {
  return {
    entityId: "demo-entity-1",
    projectId: "demo-project-1",
    title: "Actual input for a test",
    documentNo: "TEST-001",
    revision: "P01",
    classification: "Design",
    discipline: "ARC",
    suitabilityCode: "PROJECT-REVIEW",
    dueDate: "2026-09-30",
    submittedAt: "2026-09-15",
    checklist: {
      design_check: true,
      benchmark_check: true,
      coordination_check: true,
    },
    evidence: [
      {
        kind: "checklist",
        title: "Checklist",
        url: "https://cde.example/checklist",
        revision: "P01",
      },
      {
        kind: "benchmark",
        title: "Benchmark",
        url: "https://cde.example/benchmark",
        revision: "P01",
      },
    ],
    ...extra,
  };
}

test("a new store starts empty; fictional content requires explicit loading", () => {
  const s = new WorkspaceStore(":memory:");
  assert.equal(s.all("submissions").length, 0);
  assert.equal(s.all("entities").length, 0);
  loadDemo(s, owner, now);
  assert.equal(s.all("submissions").length, 18);
  assert.throws(() => loadDemo(s, owner, now), /empty workspace/);
  s.close();
});
test("authorization requires the correct entity, project and action role", () => {
  assert.equal(
    may(viewer, { entityId: "demo-entity-1", projectId: "demo-project-1" }),
    true,
  );
  assert.equal(
    may(viewer, { entityId: "demo-entity-2", projectId: "demo-project-2" }),
    false,
  );
  assert.equal(
    may(viewer, { entityId: "demo-entity-1", projectId: "secret-project" }),
    false,
  );
  assert.equal(
    may(
      viewer,
      { entityId: "demo-entity-1", projectId: "demo-project-1" },
      "contributor",
    ),
    false,
  );
});
test("gates block incomplete metadata, unchecked items and mismatched evidence", () => {
  const s = fixture(),
    record = s
      .all("submissions")
      .find((r) => r.entityId === "demo-entity-1" && r.status === "submitted")!,
    rules = rulesFor(record, s.all("rules"));
  assert.equal(validateGate(record, rules).passed, true);
  const broken = {
    ...record,
    classification: "",
    checklist: { ...record.checklist, design_check: false },
    evidence: record.evidence.map((e) => ({ ...e, revision: "SUPERSEDED" })),
  };
  const result = validateGate(broken, rules);
  assert.equal(result.passed, false);
  assert.ok(result.issues.some((i) => i.field === "classification"));
  assert.ok(result.issues.some((i) => i.code === "checklist:design_check"));
  assert.ok(result.issues.some((i) => i.code === "evidence:benchmark"));
  s.close();
});
test("self-approval and stale revision approvals cannot pass a gate", () => {
  const s = fixture(),
    record = s.all("submissions").find((r) => r.status === "submitted")!,
    rules = rulesFor(record, s.all("rules"));
  assert.equal(
    validateGate({ ...record, reviewerId: record.ownerId }, rules).passed,
    false,
  );
  assert.equal(
    validateGate({ ...record, reviewedRevision: "OLD" }, rules).passed,
    false,
  );
  assert.equal(
    validateGate(record, { ...rules, status: "draft" }).passed,
    false,
  );
  s.close();
});
test("submission creation ignores client-supplied approval and status fields", () => {
  const s = fixture(),
    record = saveSubmission(
      s,
      owner,
      validSubmission({
        reviewerId: "forged",
        reviewedRevision: "P01",
        status: "submitted",
      }),
    );
  assert.equal(record.status, "draft");
  assert.equal(record.reviewerId, "");
  assert.throws(() => submitSubmission(s, owner, record.id), /blocked/);
  assert.throws(() => reviewSubmission(s, owner, record.id), /own submission/);
  s.close();
});
test("independent authorized review enables submission; later edits reset approval", () => {
  const s = fixture(),
    record = saveSubmission(s, owner, validSubmission());
  assert.throws(() => reviewSubmission(s, viewer, record.id), /permission/);
  reviewSubmission(s, reviewer, record.id);
  assert.equal(submitSubmission(s, owner, record.id).status, "submitted");
  const changed = saveSubmission(
    s,
    owner,
    validSubmission({ id: record.id, revision: "P02" }),
  );
  assert.equal(changed.reviewerId, "");
  assert.equal(changed.status, "draft");
  assert.throws(() => submitSubmission(s, owner, record.id), /blocked/);
  s.close();
});
test("forging an existing record ID cannot move information between entities", () => {
  const s = fixture(),
    before = s.all("submissions").find((r) => r.entityId === "demo-entity-2")!;
  assert.throws(
    () => saveSubmission(s, owner, validSubmission({ id: before.id })),
    /moved across/,
  );
  assert.equal(s.get("submissions", before.id)?.entityId, "demo-entity-2");
  s.close();
});
test("project rule approval needs a procedure reference and changes require a new version", () => {
  const s = fixture(),
    base = defaultRules("demo-entity-1");
  assert.throws(
    () => saveRules(s, owner, { ...base, version: "1.0" }),
    /new version/,
  );
  const draft = saveRules(s, owner, { ...base, version: "2.0" });
  assert.throws(() => approveRules(s, owner, draft.id), /procedure/);
  const ready = saveRules(s, owner, {
    ...draft,
    approvalReference: "TEST APPROVED PROCEDURE",
  });
  assert.equal(approveRules(s, owner, ready.id).status, "approved");
  s.close();
});
test("audit periods use Dubai boundaries, including the UTC month crossover", () => {
  assert.deepEqual(monthBounds("2026-09"), {
    start: "2026-08-31T20:00:00.000Z",
    end: "2026-09-30T20:00:00.000Z",
  });
  assert.equal(previousMonth(new Date("2026-09-30T21:00:00Z")), "2026-09");
  const s = fixture(),
    record = s.all("submissions")[0];
  assert.equal(
    inAuditMonth(
      { ...record, dueDate: "", submittedAt: "2026-09-30T19:59:59Z" },
      "2026-09",
    ),
    true,
  );
  assert.equal(
    inAuditMonth(
      { ...record, dueDate: "", submittedAt: "2026-09-30T20:00:00Z" },
      "2026-09",
    ),
    false,
  );
  s.close();
});
test("monthly audits are repeat-safe and preserve frozen evidence after source changes", () => {
  const s = fixture(),
    first = runAudits(s, owner, "2026-09", now),
    findings = s.all("findings").length;
  assert.equal(first.length, 2);
  assert.ok(findings > 0);
  const second = runAudits(s, owner, "2026-09", now);
  assert.ok(second.every((a) => a.reused));
  assert.equal(s.all("findings").length, findings);
  const audit = first[0],
    original = audit.snapshots[0];
  s.save("submissions", { ...original, title: "CHANGED AFTER AUDIT" });
  const pack = evidencePack(s, owner, audit.id);
  assert.notEqual(
    pack.audit.snapshots.find((r) => r.id === original.id)?.title,
    "CHANGED AFTER AUDIT",
  );
  assert.equal(pack.audit.snapshotHash, audit.snapshotHash);
  s.close();
});
test("partial project users cannot read entity-wide audit snapshots or run complete entity audits", () => {
  const s = fixture();
  runAudits(s, owner, "2026-09", now);
  const scoped = snapshot(s, viewer);
  assert.equal(scoped.audits.length, 0);
  assert.ok(scoped.submissions.every((r) => r.entityId === "demo-entity-1"));
  assert.ok(scoped.sources.every((r) => r.projectId === "demo-project-1"));
  assert.throws(
    () => evidencePack(s, viewer, s.all("audits")[0].id),
    /all projects/,
  );
  const partialQa = {
    ...viewer,
    grants: [{ ...viewer.grants[0], role: "qa_manager" as const }],
  };
  assert.throws(() => runAudits(s, partialQa, "2026-08", now), /every project/);
  s.close();
});
test("a zero-source audit reports zero records without establishing full CDE coverage", () => {
  const s = fixture(),
    audits = runAudits(s, owner, "2026-08", now);
  assert.ok(
    audits.every((a) => a.submissionCount === 0 && a.conformingCount === 0),
  );
  assert.match(audits[0].sourceCoverage, /not established/);
  s.close();
});
test("NCR drafting requires an issued observation, an elapsed deadline and role authorization", () => {
  const s = fixture();
  runAudits(s, owner, "2026-09", now);
  const f = s.all("findings")[0];
  assert.throws(
    () => transitionFinding(s, owner, f.id, "ncr", {}, now),
    /issued observation/,
  );
  assert.throws(
    () => transitionFinding(s, viewer, f.id, "issue", {}, now),
    /permission/,
  );
  const issued = transitionFinding(s, owner, f.id, "issue", {}, now);
  assert.equal(issued.status, "observation_issued");
  assert.throws(
    () =>
      transitionFinding(s, owner, f.id, "ncr", {}, new Date(issued.dueDate!)),
    /deadline/,
  );
  const draft = transitionFinding(
    s,
    owner,
    f.id,
    "ncr",
    {},
    new Date(Date.parse(issued.dueDate!) + 1),
  );
  assert.equal(draft.status, "ncr_draft");
  assert.throws(
    () => transitionFinding(s, owner, f.id, "close", {}),
    /closureEvidence/,
  );
  assert.equal(
    transitionFinding(s, owner, f.id, "close", {
      closureEvidence:
        "Corrective action verified against test inspection record.",
    }).status,
    "closed",
  );
  s.close();
});
test("an observation retains its original response period when profiles change", () => {
  const s = fixture();
  runAudits(s, owner, "2026-09", now);
  const finding = s.all("findings")[0],
    profile = rulesFor(finding, s.all("rules"));
  s.save("rules", { ...profile, responseDays: 45 });
  const issued = transitionFinding(s, owner, finding.id, "issue", {}, now);
  assert.equal(
    Date.parse(issued.dueDate!) - now.getTime(),
    finding.responseDays * 86400000,
  );
  s.close();
});
test("imports reject invalid calendar dates atomically and never persist a partial batch", () => {
  const s = fixture(),
    before = s.all("submissions").length;
  assert.throws(
    () =>
      importRecords(s, owner, {
        entityId: "demo-entity-1",
        projectId: "demo-project-1",
        kind: "submissions",
        records: [
          validSubmission(),
          validSubmission({ dueDate: "2026-02-31" }),
        ],
      }),
    /calendar date/,
  );
  assert.equal(s.all("submissions").length, before);
  s.close();
});
test("evidence references reject active schemes and embedded credentials", () => {
  assert.throws(() => sourceUrl("javascript:alert(1)"), /HTTPS/);
  assert.throws(
    () => sourceUrl("https://user:secret@example.com/doc"),
    /credentials/,
  );
  assert.equal(sourceUrl("https://cde.example/doc"), "https://cde.example/doc");
});
test("entitlement confirmation needs evidence and roster re-imports do not inflate adoption", () => {
  const s = fixture(),
    payload = {
      entityId: "demo-entity-1",
      projectId: "demo-project-1",
      name: "Test user",
      email: "USER@example.com",
      licenceStatus: "confirmed",
      lastActiveAt: "2026-09-01",
    };
  assert.throws(() => saveAccess(s, owner, payload), /evidence/);
  const a = saveAccess(s, owner, {
      ...payload,
      sourceReference: "Reviewed licence roster",
    }),
    before = s.all("access").length;
  const b = saveAccess(s, owner, {
    ...payload,
    sourceReference: "Updated roster",
  });
  assert.equal(a.id, b.id);
  assert.equal(s.all("access").length, before);
  assert.throws(
    () => saveAccess(s, viewer, { ...payload, sourceReference: "Fake" }),
    /permission/,
  );
  s.close();
});
test("adoption uses the expected roster, actual recent dates, and an explicit zero-denominator state", () => {
  assert.equal(
    workspaceMetrics(
      { submissions: [], rules: [], findings: [], access: [] },
      now,
    ).adoption,
    null,
  );
  const s = fixture(),
    m = workspaceMetrics(s.snapshot(), now);
  assert.equal(m.expectedUsers, 10);
  assert.equal(m.activeUsers, 6);
  assert.equal(m.adoption, 60);
  s.close();
});
test("lessons retrieval excludes unauthorized entities and unapproved drafts", async () => {
  const s = fixture(),
    draft = saveLesson(s, owner, {
      entityId: "demo-entity-1",
      projectId: "demo-project-1",
      title: "Unique secret testword",
      problem: "Secret testword",
      lesson: "Do not retrieve draft testword.",
      recommendation: "Review first.",
      tags: ["testword"],
      sourceUrl: "https://cde.example/case",
      sourceRevision: "P01",
    });
  assert.equal((await retrieve(s, viewer, "testword")).hits.length, 0);
  approveLesson(s, reviewer, draft.id);
  assert.equal(
    (await retrieve(s, viewer, "testword")).hits[0].lesson.id,
    draft.id,
  );
  assert.equal(
    (await retrieve(s, viewer, "facade", "demo-entity-2")).hits.length,
    0,
  );
  const answer = await answerQuestion(s, viewer, "facade brackets");
  assert.ok(answer.citations.length);
  assert.ok(
    (await retrieve(s, viewer, "facade brackets")).hits.every(
      (h) => h.lesson.entityId === "demo-entity-1",
    ),
  );
  assert.ok(answer.answer.includes("[L1]"));
  s.close();
});
test("risk linking requires access to the lesson and the same project scope", () => {
  const s = fixture(),
    risk = s.all("risks").find((r) => r.entityId === "demo-entity-1")!,
    foreign = s.all("lessons").find((l) => l.entityId === "demo-entity-2")!,
    local = s.all("lessons").find((l) => l.projectId === risk.projectId)!;
  assert.throws(() => linkRisk(s, owner, risk.id, foreign.id), /same project/);
  assert.throws(() => linkRisk(s, viewer, risk.id, local.id), /permission/);
  assert.equal(linkRisk(s, owner, risk.id, local.id).lessonIds.length, 1);
  assert.equal(linkRisk(s, owner, risk.id, local.id).lessonIds.length, 1);
  s.close();
});

test("project-scoped readers cannot enumerate hidden sibling projects or entity-wide findings", () => {
  const s = fixture();
  s.save("projects", {
    id: "private-project",
    entityId: "demo-entity-1",
    name: "HIDDEN PROJECT NAME",
    code: "PRIVATE",
    asiteWorkspaceId: "",
  });
  const rules = s.all("rules").find((r) => r.entityId === "demo-entity-1")!;
  s.save("rules", { ...rules, minimumAdoptionPercent: 90 });
  runAudits(s, owner, "2026-09", now);
  const view = snapshot(s, viewer);
  assert.equal(view.projects.length, 1);
  assert.ok(!JSON.stringify(view).includes("HIDDEN PROJECT NAME"));
  assert.ok(view.findings.every((f) => f.projectId === "demo-project-1"));
  assert.ok(view.alerts.every((a) => a.projectId === "demo-project-1"));
  s.close();
});

test("historical adoption stays unknown without complete activity events", () => {
  const s = fixture();
  for (const a of s.all("access"))
    s.save("access", { ...a, activityHistoryComplete: false });
  const audits = runAudits(s, owner, "2026-09", now);
  assert.ok(audits.every((a) => a.adoptionRate === null));
  assert.match(audits[0].adoptionBasis, /cannot establish historical/);
  s.close();
});

test("open audit months are rejected so an early snapshot cannot replace the final monthly run", () => {
  const s = fixture();
  assert.throws(() => runAudits(s, owner, "2026-10", now), /still open/);
  assert.throws(
    () => runAudits(s, owner, "2026-09", new Date("2026-09-30T19:59:59Z")),
    /still open/,
  );
  assert.equal(
    runAudits(s, owner, "2026-09", new Date("2026-09-30T20:00:00Z")).length,
    2,
  );
  s.close();
});
test("the idempotent audit reuse path still checks complete entity authorization", () => {
  const s = fixture();
  runAudits(s, owner, "2026-09", now);
  const partialQa = {
    ...viewer,
    grants: [{ ...viewer.grants[0], role: "qa_manager" as const }],
  };
  assert.throws(() => runAudits(s, partialQa, "2026-09", now), /every project/);
  s.close();
});
test("costly requests use a persistent per-actor budget and recover after the window", () => {
  const s = new WorkspaceStore(":memory:");
  assert.equal(s.consumeBudget("actor:ask", 2, 1000, 0), true);
  assert.equal(s.consumeBudget("actor:ask", 2, 1000, 1), true);
  assert.equal(s.consumeBudget("actor:ask", 2, 1000, 2), false);
  assert.equal(s.consumeBudget("other:ask", 2, 1000, 2), true);
  assert.equal(s.consumeBudget("actor:ask", 2, 1000, 1000), true);
  s.close();
});
