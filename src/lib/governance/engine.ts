import type {
  Actor,
  GateResult,
  Lesson,
  RuleProfile,
  Scope,
  SearchHit,
  Submission,
  WorkspaceData,
} from "./types";

const ROLE_LEVEL = {
  viewer: 0,
  contributor: 1,
  reviewer: 2,
  qa_manager: 3,
  admin: 4,
} as const;
export function may(
  actor: Actor,
  record: Pick<Scope, "entityId" | "projectId">,
  minimum: keyof typeof ROLE_LEVEL = "viewer",
): boolean {
  return actor.grants.some(
    (g) =>
      (g.entityId === "*" || g.entityId === record.entityId) &&
      (!record.projectId ||
        g.projectIds.includes("*") ||
        g.projectIds.includes(record.projectId)) &&
      ROLE_LEVEL[g.role] >= ROLE_LEVEL[minimum],
  );
}
export function defaultRules(
  entityId: string,
  projectId?: string,
): RuleProfile {
  return {
    id: `rules-${entityId}-${projectId || "entity"}`,
    entityId,
    projectId,
    name: "Project information requirements",
    version: "1.0",
    status: "draft",
    approvalReference: "",
    requiredMetadata: [
      "documentNo",
      "revision",
      "classification",
      "discipline",
      "suitabilityCode",
    ],
    allowedSuitability: [],
    requiredChecklist: [
      "design_check",
      "benchmark_check",
      "coordination_check",
    ],
    requiredEvidence: ["checklist", "benchmark"],
    responseDays: 7,
  };
}
export function rulesFor(
  submission: Scope,
  profiles: RuleProfile[],
): RuleProfile {
  return (
    profiles.find(
      (r) =>
        r.entityId === submission.entityId &&
        r.projectId === submission.projectId,
    ) ??
    profiles.find((r) => r.entityId === submission.entityId && !r.projectId) ??
    defaultRules(submission.entityId, submission.projectId)
  );
}
export function validateGate(s: Submission, rules: RuleProfile): GateResult {
  const issues: GateResult["issues"] = [];
  for (const field of rules.requiredMetadata) {
    const value = (s as unknown as Record<string, unknown>)[field];
    if (typeof value !== "string" || !value.trim())
      issues.push({
        code: `metadata:${field}`,
        field,
        requirement: `${field} must be provided (${rules.name} v${rules.version}).`,
        actual: "Required metadata is missing.",
        severity: "minor",
      });
  }
  if (
    rules.allowedSuitability.length &&
    s.suitabilityCode &&
    !rules.allowedSuitability.includes(s.suitabilityCode)
  )
    issues.push({
      code: "metadata:suitability",
      field: "suitabilityCode",
      requirement: `Suitability must be one of: ${rules.allowedSuitability.join(", ")}.`,
      actual: `Recorded value: ${s.suitabilityCode}.`,
      severity: "minor",
    });
  for (const item of rules.requiredChecklist)
    if (s.checklist[item] !== true)
      issues.push({
        code: `checklist:${item}`,
        field: item,
        requirement: `Complete the mandatory ${item.replaceAll("_", " ")} checklist item.`,
        actual: "The item has not been confirmed.",
        severity: "major",
      });
  for (const kind of rules.requiredEvidence) {
    const evidence = s.evidence.filter((e) => e.kind === kind);
    if (!evidence.some((e) => e.url && e.revision === s.revision))
      issues.push({
        code: `evidence:${kind}`,
        field: kind,
        requirement: `Provide ${kind} evidence matching submission revision ${s.revision || "(not specified)"}.`,
        actual: evidence.length
          ? "Evidence is incomplete or references another revision."
          : "No matching evidence reference was supplied.",
        severity: "major",
      });
  }
  if (
    !s.reviewerId ||
    s.reviewerId === s.ownerId ||
    s.reviewedRevision !== s.revision
  )
    issues.push({
      code: "approval:independent-review",
      field: "reviewerId",
      requirement:
        "An authorized reviewer other than the author must approve the current revision.",
      actual: !s.reviewerId
        ? "No reviewer approval is recorded."
        : s.reviewerId === s.ownerId
          ? "The reviewer and author are the same person."
          : "The approval relates to a different revision.",
      severity: "major",
    });
  return {
    passed: issues.length === 0 && rules.status === "approved",
    rulesApproved: rules.status === "approved",
    ruleVersion: rules.version,
    issues,
  };
}
export function validMonth(month: string): boolean {
  return (
    /^\d{4}-(0[1-9]|1[0-2])$/.test(month) &&
    +month.slice(0, 4) >= 2000 &&
    +month.slice(0, 4) <= 2100
  );
}
export function monthBounds(month: string): { start: string; end: string } {
  if (!validMonth(month))
    throw new Error("Use a valid audit month in YYYY-MM format.");
  const [year, m] = month.split("-").map(Number);
  // Midnight in Asia/Dubai is 20:00 UTC on the preceding date; Dubai has no DST.
  return {
    start: new Date(Date.UTC(year, m - 1, 1, -4)).toISOString(),
    end: new Date(Date.UTC(year, m, 1, -4)).toISOString(),
  };
}
export function previousMonth(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Dubai",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const year = Number(parts.find((x) => x.type === "year")!.value),
    month = Number(parts.find((x) => x.type === "month")!.value);
  const previous = new Date(Date.UTC(year, month - 2, 1));
  return previous.toISOString().slice(0, 7);
}
export function inAuditMonth(s: Submission, month: string): boolean {
  const { start, end } = monthBounds(month);
  return [s.submittedAt, s.dueDate].some((v) => {
    const ms = Date.parse(v);
    return (
      Number.isFinite(ms) && ms >= Date.parse(start) && ms < Date.parse(end)
    );
  });
}
export function overdueDays(date: string, now = new Date()): number {
  if (!date) return 0;
  const ms = Date.parse(date);
  return Number.isFinite(ms)
    ? Math.max(0, Math.floor((now.getTime() - ms) / 86400000))
    : 0;
}
export function dueRisk(
  s: Submission,
  now = new Date(),
): { label: string; level: "high" | "medium" | "low"; reason: string } {
  if (s.status === "submitted")
    return {
      label: "Submitted",
      level: "low",
      reason: "The local submission gate has been passed.",
    };
  if (!s.dueDate)
    return {
      label: "Date needed",
      level: "medium",
      reason: "A due date is required to assess timeliness.",
    };
  const days = (Date.parse(s.dueDate) - now.getTime()) / 86400000;
  if (days < 0)
    return {
      label: "Overdue",
      level: "high",
      reason: `Past the recorded due date by ${Math.max(1, Math.ceil(-days))} day(s).`,
    };
  if (days <= 3)
    return {
      label: "Due soon",
      level: "medium",
      reason:
        "Due within three days. This is a rule-based alert, not an ML forecast.",
    };
  return {
    label: "On track",
    level: "low",
    reason: "Recorded due date is more than three days away.",
  };
}
const STOP = new Set(
  "a an the and or of to for from in on with is are was were be been by as at that this it how what can we should do our new".split(
    " ",
  ),
);
export function tokens(value: string): string[] {
  return (
    value
      .toLowerCase()
      .normalize("NFKC")
      .match(/[\p{L}\p{N}]{2,}/gu)
      ?.filter((t) => !STOP.has(t)) ?? []
  );
}
export function searchLessons(
  query: string,
  lessons: Lesson[],
  limit = 5,
): SearchHit[] {
  const terms = [...new Set(tokens(query))];
  if (!terms.length) return [];
  const docs = lessons
    .filter((l) => l.status === "approved")
    .map((lesson) => ({
      lesson,
      terms: tokens(
        `${lesson.title} ${lesson.title} ${lesson.tags.join(" ")} ${lesson.problem} ${lesson.lesson} ${lesson.recommendation}`,
      ),
    }));
  const ranked = docs
    .map(({ lesson, terms: words }) => {
      let score = 0;
      const matched: string[] = [];
      for (const term of terms) {
        const count = words.filter((w) => w === term).length;
        if (count) {
          const frequency = docs.filter((d) => d.terms.includes(term)).length;
          score +=
            (count / (count + 1.2)) *
            Math.log(1 + (docs.length - frequency + 0.5) / (frequency + 0.5));
          matched.push(term);
        }
      }
      return {
        lesson,
        score,
        reason: matched.length
          ? `Matches: ${matched.join(", ")}`
          : "No matching terms",
      };
    })
    .filter((x) => x.score > 0)
    .sort(
      (a, b) => b.score - a.score || a.lesson.id.localeCompare(b.lesson.id),
    );
  return ranked.slice(0, limit);
}
export function workspaceMetrics(
  data: Pick<WorkspaceData, "submissions" | "rules" | "findings" | "access">,
  now = new Date(),
) {
  const total = data.submissions.length,
    passed = data.submissions.filter(
      (s) => validateGate(s, rulesFor(s, data.rules)).passed,
    ).length;
  const expected = data.access.filter((a) => a.expected),
    active = expected.filter(
      (a) =>
        a.lastActiveAt &&
        Date.parse(a.lastActiveAt) >= now.getTime() - 30 * 86400000 &&
        Date.parse(a.lastActiveAt) <= now.getTime(),
    );
  return {
    total,
    passed,
    compliance: total ? Math.round((100 * passed) / total) : null,
    openFindings: data.findings.filter((f) => f.status !== "closed").length,
    overdue: data.submissions.filter(
      (s) =>
        s.status !== "submitted" &&
        s.dueDate &&
        Date.parse(s.dueDate) < now.getTime(),
    ).length,
    adoption: expected.length
      ? Math.round((100 * active.length) / expected.length)
      : null,
    activeUsers: active.length,
    expectedUsers: expected.length,
  };
}
