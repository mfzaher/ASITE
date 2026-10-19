import { authorize } from "./service";
import { WorkspaceError } from "./auth";
import { defaultRules, monthBounds, previousMonth } from "./engine";
import type { Actor, Submission } from "./types";
import type { WorkspaceStore } from "./store";

/** Fictional training content; seeded only after an explicit user action. */
export function loadDemo(
  store: WorkspaceStore,
  actor: Actor,
  now = new Date(),
) {
  authorize(actor, { entityId: "*" }, "admin");
  if (store.all("entities").length)
    throw new WorkspaceError(
      "Sample data can only be loaded into an empty workspace.",
      409,
    );
  const month = previousMonth(now),
    start = Date.parse(monthBounds(month).start),
    stamp = now.toISOString();
  return store.transaction(() => {
    for (let e = 0; e < 2; e++) {
      const entityId = `demo-entity-${e + 1}`,
        projectId = `demo-project-${e + 1}`;
      store.save("entities", {
        id: entityId,
        entityId,
        name: e ? "Demo • Infrastructure" : "Demo • Buildings",
        owner: "M. Zaher",
        entitlement: "unverified",
        entitlementReference: "",
      });
      store.save("projects", {
        id: projectId,
        entityId,
        name: e ? "Demo • District utilities" : "Demo • Harbour residences",
        code: e ? "DEMO-02" : "DEMO-01",
        asiteWorkspaceId: "",
      });
      store.save("rules", {
        ...defaultRules(entityId),
        name: "Demonstration information requirements",
        status: "approved",
        approvalReference:
          "FICTIONAL TRAINING PROFILE — replace with an approved ECC/project procedure",
        approvedBy: "Demonstration administrator",
        approvedAt: stamp,
      });
      for (let i = 0; i < 9; i++) {
        const id = `demo-submission-${e}-${i}`,
          revision = i % 2 ? "P02" : "P01",
          complete = i % 3 === 0;
        const evidence = ["checklist", "benchmark"]
          .filter((_, j) => complete || j === 0)
          .map((kind) => {
            const sourceId = `demo-evidence-${e}-${i}-${kind}`;
            store.save("sources", {
              id: sourceId,
              entityId,
              projectId,
              title: `Fictional ${kind} evidence — DEMO-${e + 1}-${String(i + 1).padStart(3, "0")}`,
              revision,
              sampleData: true,
              content: `FICTIONAL TRAINING RECORD\nDocument: DEMO-${e + 1}-${String(i + 1).padStart(3, "0")}\nRevision: ${revision}\nEvidence type: ${kind}\nThis training record demonstrates revision-linked evidence. It does not represent an ECC submission, inspection or approval.`,
            });
            return {
              id: sourceId,
              kind,
              title: `${kind} record`,
              url: `/api/control/evidence/${sourceId}`,
              revision,
            };
          });
        const s: Submission = {
          id,
          entityId,
          projectId,
          title: [
            "Facade bracket coordination",
            "Waterproofing inspection plan",
            "MEP service opening review",
          ][i % 3],
          documentNo: `DEMO-${e + 1}-${String(i + 1).padStart(3, "0")}`,
          revision,
          classification: i % 4 === 1 ? "" : "Design information",
          discipline: ["ARC", "STR", "MEP"][i % 3],
          suitabilityCode: "PROJECT-REVIEW",
          owner: ["Demo author A", "Demo author B", "Demo author C"][i % 3],
          ownerId: `demo-author-${i % 3}`,
          dueDate: new Date(start + (7 + i) * 86400000).toISOString(),
          submittedAt: new Date(start + (4 + i) * 86400000).toISOString(),
          status: complete ? "submitted" : "draft",
          checklist: {
            design_check: true,
            benchmark_check: complete,
            coordination_check: complete || i % 4 !== 2,
          },
          evidence,
          reviewerId: complete ? "demo-independent-reviewer" : "",
          reviewerName: complete ? "Demo independent reviewer" : "",
          reviewedRevision: complete ? revision : "",
          createdAt: stamp,
          sourceKind: "demo",
          sourceReference: "Fictional sample dataset",
        };
        store.save("submissions", s);
      }
      const lessons = [
        {
          title: "Coordinate facade brackets before drawing release",
          problem:
            "Facade brackets conflicted with structural edge clearances during a fictional coordination review.",
          lesson:
            "Compare bracket locations against the current structural edge drawings before submission.",
          recommendation:
            "Include an interdisciplinary coordination check and revision-matched benchmark evidence.",
          tags: ["facade", "brackets", "coordination", "structural"],
        },
        {
          title: "Verify waterproofing evidence before approval",
          problem:
            "A fictional waterproofing submittal omitted its benchmark and inspection evidence.",
          lesson:
            "A checklist confirmation alone does not establish that supporting evidence is present.",
          recommendation:
            "Require the benchmark reference and the inspection checklist at the same revision as the submission.",
          tags: ["waterproofing", "inspection", "evidence", "benchmark"],
        },
        {
          title: "Confirm MEP openings against the latest revision",
          problem:
            "A fictional services opening was checked against an earlier model revision.",
          lesson:
            "Revision alignment is required across the drawing, evidence and reviewer approval.",
          recommendation:
            "Reset approval when the submission revision changes and repeat the coordination review.",
          tags: ["MEP", "opening", "revision", "coordination"],
        },
      ];
      lessons.forEach((l, i) => {
        const id = `demo-lesson-${e}-${i}`,
          sourceId = `demo-lesson-source-${e}-${i}`;
        store.save("sources", {
          id: sourceId,
          entityId,
          projectId,
          title: `Fictional lesson case: ${l.title}`,
          content: `FICTIONAL TRAINING CASE\n\n${l.problem}\n\nLesson: ${l.lesson}\n\nRecommended action: ${l.recommendation}`,
          revision: "DEMO-1",
          sampleData: true,
        });
        store.save("lessons", {
          ...l,
          id,
          entityId,
          projectId,
          sourceUrl: "",
          sourceRevision: "DEMO-1",
          sourceId,
          owner: "Demo quality team",
          status: "approved",
          createdAt: stamp,
          sampleData: true,
        });
      });
      const processId = `demo-process-${e}`;
      store.save("processes", {
        id: processId,
        entityId,
        projectId,
        name: "Design coordination and submission review",
        description:
          "Fictional process for demonstrating lesson-to-risk relationships.",
      });
      store.save("risks", {
        id: `demo-risk-${e}`,
        entityId,
        projectId,
        title: e
          ? "MEP openings may use a superseded revision"
          : "Facade brackets may conflict with structural edges",
        description:
          "A coordination gap may cause drawing rejection and rework.",
        owner: "Demo technical manager",
        likelihood: 3,
        impact: 4,
        status: "open",
        processId,
        lessonIds: [],
        mitigation:
          "Review relevant lessons and verify current coordination evidence.",
        createdAt: stamp,
      });
      for (let i = 0; i < 5; i++)
        store.save("access", {
          id: `demo-access-${e}-${i}`,
          entityId,
          projectId,
          name: `Demo user ${e + 1}.${i + 1}`,
          email: `demo-${e}-${i}@example.invalid`,
          expected: true,
          licenceStatus: i < 3 ? "confirmed" : "unverified",
          lastActiveAt:
            i < 3
              ? new Date(now.getTime() - (i + 2) * 86400000).toISOString()
              : "",
          sourceReference:
            "FICTIONAL licence roster and complete activity record",
          activityDates:
            i < 3
              ? [
                  new Date(start + (8 + i) * 86400000).toISOString(),
                  new Date(now.getTime() - (i + 2) * 86400000).toISOString(),
                ]
              : [],
          activityHistoryComplete: true,
        });
    }
    store.event(
      actor.id,
      "demo.loaded",
      { entityId: "demo-entity-1" },
      "Fictional demonstration data loaded by explicit request.",
    );
    return {
      entities: 2,
      submissions: 18,
      lessons: 6,
      month,
      sampleData: true,
    };
  });
}
