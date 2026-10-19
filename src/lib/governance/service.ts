import { createHash, randomUUID } from "node:crypto";
import { WorkspaceError } from "./auth";
import { WorkspaceStore } from "./store";
import {
  defaultRules,
  inAuditMonth,
  may,
  monthBounds,
  previousMonth,
  rulesFor,
  validateGate,
} from "./engine";
import {
  COLLECTIONS,
  type Actor,
  type Collection,
  type Evidence,
  type Finding,
  type Lesson,
  type Role,
  type RuleProfile,
  type Scope,
  type Submission,
  type WorkspaceSnapshot,
} from "./types";

export function text(
  b: Record<string, unknown>,
  key: string,
  required = true,
  max = 500,
): string {
  const raw = b[key];
  if (raw === undefined || raw === null) {
    if (required) throw new WorkspaceError(`${key} is required.`);
    return "";
  }
  if (typeof raw !== "string" || raw.length > max)
    throw new WorkspaceError(
      `${key} must be text with at most ${max} characters.`,
    );
  const value = raw.trim();
  if (required && !value) throw new WorkspaceError(`${key} is required.`);
  return value;
}
function list(b: Record<string, unknown>, key: string, max = 30): string[] {
  const v = b[key];
  if (v === undefined) return [];
  if (
    !Array.isArray(v) ||
    v.length > max ||
    v.some((x) => typeof x !== "string" || !x.trim() || x.length > 150)
  )
    throw new WorkspaceError(`${key} must be a list of short text values.`);
  return [...new Set((v as string[]).map((s) => s.trim()))];
}
function identifier(
  b: Record<string, unknown>,
  key: string,
  required = true,
): string {
  const v = text(b, key, required, 150);
  if (v && !/^[a-zA-Z0-9_:-]+$/.test(v))
    throw new WorkspaceError(`${key} contains unsupported characters.`);
  return v;
}
function date(
  b: Record<string, unknown>,
  key: string,
  required = false,
): string {
  const v = text(b, key, required, 40);
  if (!v) return "";
  if (
    !/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2}))?$/.test(
      v,
    )
  )
    throw new WorkspaceError(`${key} must use an ISO date or timestamp.`);
  const dayPart = new Date(`${v.slice(0, 10)}T00:00:00Z`);
  if (
    !Number.isFinite(dayPart.getTime()) ||
    dayPart.toISOString().slice(0, 10) !== v.slice(0, 10)
  )
    throw new WorkspaceError(`${key} contains an invalid calendar date.`);
  const parsed = new Date(
    /^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T23:59:59+04:00` : v,
  );
  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.getUTCFullYear() < 2000 ||
    parsed.getUTCFullYear() > 2100
  )
    throw new WorkspaceError(`${key} must contain a valid date.`);
  return parsed.toISOString();
}
export function sourceUrl(value: string): string {
  if (!value) return "";
  try {
    const u = new URL(value);
    if (u.protocol !== "https:" || u.username || u.password) throw new Error();
    return u.toString();
  } catch {
    throw new WorkspaceError(
      "Evidence and CDE source links must be HTTPS URLs without embedded credentials.",
    );
  }
}
export function authorize(
  actor: Actor,
  scope: Pick<Scope, "entityId" | "projectId">,
  role: Role = "viewer",
) {
  if (!may(actor, scope, role))
    throw new WorkspaceError(
      "You do not have the required permission for this entity/project.",
      403,
    );
}
function scope(
  store: WorkspaceStore,
  actor: Actor,
  b: Record<string, unknown>,
  role: Role = "contributor",
  needsProject = true,
): { entityId: string; projectId?: string } {
  const entityId = identifier(b, "entityId"),
    projectId = identifier(b, "projectId", needsProject) || undefined;
  authorize(actor, { entityId, projectId: projectId || "*" }, role);
  if (!store.get("entities", entityId))
    throw new WorkspaceError("Choose an existing entity.");
  if (projectId && store.get("projects", projectId)?.entityId !== entityId)
    throw new WorkspaceError("The project does not belong to this entity.");
  return { entityId, projectId };
}
function record<K extends Collection>(
  store: WorkspaceStore,
  actor: Actor,
  collection: K,
  id: string,
  role: Role = "viewer",
) {
  const r = store.get(collection, id);
  if (!r) throw new WorkspaceError("Record not found.", 404);
  authorize(actor, r, role);
  return r;
}
export function snapshot(
  store: WorkspaceStore,
  actor: Actor,
): WorkspaceSnapshot {
  const data = store.snapshot();
  for (const key of COLLECTIONS) {
    const filtered = data[key].filter(
      (r) =>
        may(
          actor,
          key === "projects" ? { entityId: r.entityId, projectId: r.id } : r,
        ) &&
        (key !== "memberships" || may(actor, r, "admin")) &&
        (!["audits", "events", "alerts", "findings"].includes(key) ||
          Boolean(r.projectId) ||
          actor.grants.some(
            (g) =>
              (g.entityId === "*" || g.entityId === r.entityId) &&
              g.projectIds.includes("*"),
          )) &&
        (key !== "lessons" ||
          (r as Lesson).status === "approved" ||
          may(actor, r, "reviewer")),
    );
    (data as unknown as Record<string, unknown>)[key] = filtered;
  }
  return {
    ...data,
    actor,
    now: new Date().toISOString(),
    gateResults: Object.fromEntries(
      data.submissions.map((s) => [
        s.id,
        validateGate(s, rulesFor(s, data.rules)),
      ]),
    ),
    readiness: {
      asite: data.projects.some((p) => Boolean(p.asiteWorkspaceId)),
      nativeGates: false,
      powerBi: Boolean(
        process.env.ECC_REPORTING_TOKEN && process.env.ECC_REPORTING_ENTITIES,
      ),
      ai: Boolean(process.env.AI_GATEWAY_API_KEY && process.env.ECC_AI_MODEL),
      semantic: Boolean(
        process.env.AI_GATEWAY_API_KEY && process.env.ECC_EMBEDDING_MODEL,
      ),
      scheduler: Boolean(
        process.env.ECC_CRON_SECRET && process.env.ECC_AUDIT_ENTITIES,
      ),
    },
  };
}
export function saveEntity(
  store: WorkspaceStore,
  actor: Actor,
  b: Record<string, unknown>,
) {
  authorize(actor, { entityId: "*", projectId: "*" }, "admin");
  const id = identifier(b, "id", false) || randomUUID();
  if (store.get("entities", id))
    throw new WorkspaceError("An entity with this ID already exists.", 409);
  const entity = {
    id,
    entityId: id,
    name: text(b, "name"),
    owner: text(b, "owner", false) || actor.name,
    entitlement: "unverified" as const,
    entitlementReference: "",
  };
  store.transaction(() => {
    store.save("entities", entity);
    store.save("rules", defaultRules(id));
    store.event(
      actor.id,
      "entity.created",
      entity,
      `Entity created: ${entity.name}`,
    );
  });
  return entity;
}
export function saveProject(
  store: WorkspaceStore,
  actor: Actor,
  b: Record<string, unknown>,
) {
  const s = scope(store, actor, b, "admin", false),
    id = identifier(b, "id", false) || randomUUID();
  if (store.get("projects", id))
    throw new WorkspaceError("A project with this ID already exists.", 409);
  const p = {
    ...s,
    id,
    name: text(b, "name"),
    code: text(b, "code", false, 30),
    asiteWorkspaceId: text(b, "asiteWorkspaceId", false, 150),
  };
  store.transaction(() => {
    store.save("projects", p);
    store.save("rules", defaultRules(s.entityId, p.id));
    store.event(actor.id, "project.created", p, `Project created: ${p.name}`);
  });
  return p;
}
export function saveSubmission(
  store: WorkspaceStore,
  actor: Actor,
  b: Record<string, unknown>,
) {
  const s = scope(store, actor, b),
    id = identifier(b, "id", false) || randomUUID(),
    previous = store.get("submissions", id);
  if (previous) {
    authorize(actor, previous, "contributor");
    if (previous.ownerId !== actor.id && !may(actor, previous, "qa_manager"))
      throw new WorkspaceError(
        "Only the author or quality manager can edit this submission.",
        403,
      );
  }
  const profile = rulesFor({ ...s, id }, store.all("rules")),
    checklist: Record<string, boolean> = {};
  const input = b.checklist;
  if (
    input !== undefined &&
    (!input || typeof input !== "object" || Array.isArray(input))
  )
    throw new WorkspaceError("checklist must be an object.");
  for (const key of profile.requiredChecklist) {
    const value = (input as Record<string, unknown> | undefined)?.[key];
    if (value !== undefined && typeof value !== "boolean")
      throw new WorkspaceError("Checklist answers must be true or false.");
    checklist[key] = value === true;
  }
  if (b.evidence !== undefined && !Array.isArray(b.evidence))
    throw new WorkspaceError("evidence must be a list.");
  const evidence: Evidence[] = (
    (b.evidence || []) as Record<string, unknown>[]
  ).map((e) => {
    if (!e || typeof e !== "object")
      throw new WorkspaceError("Invalid evidence reference.");
    return {
      id: randomUUID(),
      kind: text(e, "kind", true, 100),
      title: text(e, "title"),
      url: sourceUrl(text(e, "url", true, 2000)),
      revision: text(e, "revision", true, 100),
    };
  });
  if (evidence.length > 30)
    throw new WorkspaceError("Use at most 30 evidence references.");
  const submission: Submission = {
    ...s,
    id,
    title: text(b, "title"),
    documentNo: text(b, "documentNo", false, 200),
    revision: text(b, "revision", false, 100),
    classification: text(b, "classification", false, 200),
    discipline: text(b, "discipline", false, 100),
    suitabilityCode: text(b, "suitabilityCode", false, 100),
    owner: previous?.owner || actor.name,
    ownerId: previous?.ownerId || actor.id,
    dueDate: date(b, "dueDate"),
    submittedAt: date(b, "submittedAt"),
    status: "draft",
    checklist,
    evidence,
    reviewerId: "",
    reviewerName: "",
    reviewedRevision: "",
    createdAt: previous?.createdAt || new Date().toISOString(),
    sourceKind: b.sourceKind === "import" ? "import" : "manual",
    sourceReference: text(b, "sourceReference", false, 2000),
  };
  store.transaction(() => {
    store.save("submissions", submission);
    store.event(
      actor.id,
      "submission.saved",
      submission,
      `${previous ? "Updated" : "Created"} ${submission.documentNo || submission.title}; approval reset.`,
    );
  });
  return submission;
}
export function reviewSubmission(
  store: WorkspaceStore,
  actor: Actor,
  id: string,
) {
  const s = record(store, actor, "submissions", id, "reviewer");
  if (s.ownerId === actor.id)
    throw new WorkspaceError(
      "The author cannot approve their own submission.",
      409,
    );
  const result = validateGate(
    {
      ...s,
      reviewerId: actor.id,
      reviewerName: actor.name,
      reviewedRevision: s.revision,
    },
    rulesFor(s, store.all("rules")),
  );
  if (!result.passed)
    throw new WorkspaceError(
      !result.rulesApproved
        ? "Approve the project rule profile first."
        : "Complete the metadata, checklist and matching evidence before approval.",
      409,
    );
  const updated = {
    ...s,
    reviewerId: actor.id,
    reviewerName: actor.name,
    reviewedRevision: s.revision,
  };
  store.transaction(() => {
    store.save("submissions", updated);
    store.event(
      actor.id,
      "submission.reviewed",
      s,
      `Independent review recorded for revision ${s.revision}.`,
    );
  });
  return updated;
}
export function submitSubmission(
  store: WorkspaceStore,
  actor: Actor,
  id: string,
) {
  const s = record(store, actor, "submissions", id, "contributor");
  const gate = validateGate(s, rulesFor(s, store.all("rules")));
  if (!gate.passed)
    throw new WorkspaceError(
      !gate.rulesApproved
        ? "The project rule profile needs approval."
        : `Submission blocked: ${gate.issues.map((i) => i.requirement).join(" ")}`,
      409,
    );
  const updated = {
    ...s,
    status: "submitted" as const,
    submittedAt: new Date().toISOString(),
  };
  store.transaction(() => {
    store.save("submissions", updated);
    store.event(
      actor.id,
      "submission.submitted",
      s,
      "Local mandatory gate passed. Native Asite publication has not been performed.",
    );
  });
  return updated;
}
export function saveRules(
  store: WorkspaceStore,
  actor: Actor,
  b: Record<string, unknown>,
) {
  const s = scope(store, actor, b, "qa_manager", false),
    base = defaultRules(s.entityId, s.projectId),
    existing = store.get("rules", base.id);
  const metadata = list(b, "requiredMetadata"),
    allowed = new Set([
      "documentNo",
      "revision",
      "classification",
      "discipline",
      "suitabilityCode",
      "owner",
      "dueDate",
      "submittedAt",
    ]);
  if (!metadata.length || metadata.some((k) => !allowed.has(k)))
    throw new WorkspaceError("Choose supported mandatory metadata fields.");
  const requiredChecklist = list(b, "requiredChecklist"),
    requiredEvidence = list(b, "requiredEvidence");
  if (!requiredChecklist.length || !requiredEvidence.length)
    throw new WorkspaceError(
      "At least one checklist item and evidence type are required.",
    );
  if (
    requiredChecklist.some((k) => !/^[a-z][a-z0-9_]{1,60}$/.test(k)) ||
    requiredEvidence.some((k) => !/^[a-z][a-z0-9_]{1,60}$/.test(k))
  )
    throw new WorkspaceError(
      "Checklist and evidence keys must use lowercase letters, numbers and underscores.",
    );
  const responseDays = Number(b.responseDays);
  if (!Number.isInteger(responseDays) || responseDays < 1 || responseDays > 90)
    throw new WorkspaceError(
      "Observation response days must be between 1 and 90.",
    );
  const version = text(b, "version", true, 40);
  if (existing?.status === "approved" && existing.version === version)
    throw new WorkspaceError(
      "Use a new version when changing an approved profile.",
      409,
    );
  const target =
    b.minimumAdoptionPercent === "" ||
    b.minimumAdoptionPercent === undefined ||
    b.minimumAdoptionPercent === null
      ? null
      : Number(b.minimumAdoptionPercent);
  if (
    target !== null &&
    (!Number.isFinite(target) || target < 0 || target > 100)
  )
    throw new WorkspaceError(
      "The approved adoption target must be between 0 and 100 percent.",
    );
  const rules: RuleProfile = {
    ...base,
    name: text(b, "name"),
    version,
    status: "draft",
    approvalReference: text(b, "approvalReference", false, 1000),
    requiredMetadata: metadata,
    allowedSuitability: list(b, "allowedSuitability"),
    requiredChecklist,
    requiredEvidence,
    responseDays,
    minimumAdoptionPercent: target,
  };
  store.transaction(() => {
    store.save("rules", rules);
    store.event(
      actor.id,
      "rules.saved",
      rules,
      `Draft profile ${rules.name} v${rules.version} saved.`,
    );
  });
  return rules;
}
export function approveRules(store: WorkspaceStore, actor: Actor, id: string) {
  const rules = record(store, actor, "rules", id, "qa_manager");
  if (!rules.approvalReference.trim())
    throw new WorkspaceError(
      "Add the approved project procedure/reference before approving these rules.",
      409,
    );
  const updated = {
    ...rules,
    status: "approved" as const,
    approvedBy: actor.name,
    approvedAt: new Date().toISOString(),
  };
  store.transaction(() => {
    store.save("rules", updated);
    store.event(
      actor.id,
      "rules.approved",
      rules,
      `Profile v${rules.version} approved against ${rules.approvalReference}.`,
    );
  });
  return updated;
}
export function runAudits(
  store: WorkspaceStore,
  actor: Actor,
  month = previousMonth(),
  now = new Date(),
) {
  const bounds = monthBounds(month);
  if (Date.parse(bounds.end) > now.getTime())
    throw new WorkspaceError(
      "The audit month is still open. Select a completed month in Asia/Dubai.",
    );
  const entities = store
    .all("entities")
    .filter((e) => may(actor, e, "qa_manager"));
  if (!entities.length)
    throw new WorkspaceError(
      "No entities are available to this audit account.",
      403,
    );
  const profiles = store.all("rules"),
    nowIso = now.toISOString();
  return store.transaction(() =>
    entities.map((entity) => {
      const id = `audit:${entity.id}:${month}`;
      // An entity-wide audit requires entity-wide project access; a partial reviewer must not create a complete-looking report.
      if (
        !actor.grants.some(
          (g) =>
            (g.entityId === "*" || g.entityId === entity.id) &&
            g.projectIds.includes("*") &&
            ["admin", "qa_manager"].includes(g.role),
        )
      )
        throw new WorkspaceError(
          "Monthly entity audits require access to every project in the entity.",
          403,
        );
      const old = store.get("audits", id);
      if (old) return { ...old, reused: true };
      const submissions = store
        .all("submissions")
        .filter((s) => s.entityId === entity.id && inAuditMonth(s, month));
      if (submissions.some((s) => rulesFor(s, profiles).status !== "approved"))
        throw new WorkspaceError(
          `Approve rule profiles for ${entity.name} before running the audit.`,
          409,
        );
      let conformingCount = 0,
        findingCount = 0;
      for (const s of submissions) {
        const result = validateGate(s, rulesFor(s, profiles));
        if (result.passed) {
          conformingCount++;
          continue;
        }
        const finding: Finding = {
          id: randomUUID(),
          entityId: s.entityId,
          projectId: s.projectId,
          auditId: id,
          submissionId: s.id,
          title: `Submission check: ${s.documentNo || s.title}`,
          requirement: result.issues.map((i) => i.requirement).join("\n"),
          actual: result.issues.map((i) => i.actual).join("\n"),
          severity: result.issues.some((i) => i.severity === "major")
            ? "major"
            : "minor",
          status: "observation_draft",
          evidence: s.evidence,
          ruleVersion: result.ruleVersion,
          responseDays: rulesFor(s, profiles).responseDays,
          owner: s.owner,
          createdAt: nowIso,
        };
        store.save("findings", finding);
        findingCount++;
      }
      const roster = store
        .all("access")
        .filter((a) => a.entityId === entity.id && a.expected);
      const complete =
        roster.length > 0 &&
        roster.every((a) => a.activityHistoryComplete === true);
      const monthlyActiveUsers = roster.filter((a) =>
        (a.activityDates || []).some(
          (d) =>
            Date.parse(d) >= Date.parse(bounds.start) &&
            Date.parse(d) < Date.parse(bounds.end),
        ),
      ).length;
      const adoptionRate = complete
        ? Math.round((100 * monthlyActiveUsers) / roster.length)
        : null;
      const entityRules = profiles.find(
        (r) => r.entityId === entity.id && !r.projectId,
      );
      if (
        adoptionRate !== null &&
        entityRules?.status === "approved" &&
        entityRules.minimumAdoptionPercent != null &&
        adoptionRate < entityRules.minimumAdoptionPercent
      ) {
        store.save("findings", {
          id: randomUUID(),
          entityId: entity.id,
          auditId: id,
          submissionId: "",
          title: `Monthly adoption below the approved ${entityRules.minimumAdoptionPercent}% target`,
          requirement: `${entityRules.name} v${entityRules.version}: monthly adoption must meet ${entityRules.minimumAdoptionPercent}%.`,
          actual: `${monthlyActiveUsers}/${roster.length} expected roster entries have recorded activity in ${month} (${adoptionRate}%). Source references: ${roster.map((a) => a.sourceReference || "not provided").join("; ")}`,
          severity: "minor",
          status: "observation_draft",
          evidence: [],
          ruleVersion: entityRules.version,
          responseDays: entityRules.responseDays,
          owner: entity.owner,
          createdAt: nowIso,
        });
        findingCount++;
      }
      const audit = {
        id,
        entityId: entity.id,
        month,
        runAt: nowIso,
        actor: actor.name,
        submissionCount: submissions.length,
        conformingCount,
        findingCount,
        sourceCoverage:
          "Workspace records selected by supplied submission/due dates. Metadata is observed at audit run time; complete Asite coverage and historical state are not established.",
        snapshotHash: createHash("sha256")
          .update(
            JSON.stringify({
              submissions: [...submissions].sort((a, b) =>
                a.id.localeCompare(b.id),
              ),
              access: [...roster].sort((a, b) => a.id.localeCompare(b.id)),
            }),
          )
          .digest("hex"),
        snapshots: submissions,
        ruleVersions: [
          ...new Set(submissions.map((s) => rulesFor(s, profiles).version)),
        ],
        sampleData: submissions.some((s) => s.sourceKind === "demo"),
        expectedUsers: roster.length,
        monthlyActiveUsers,
        adoptionRate,
        adoptionBasis: complete
          ? "Activity history declared complete by the source provider; expected roster supplied at audit time. Use a period-end roster for historical reporting."
          : "Complete monthly activity history was not supplied. Latest activity timestamps alone cannot establish historical monthly adoption.",
        accessSnapshots: roster,
      };
      store.save("audits", audit);
      store.save("alerts", {
        id: `alert:${id}`,
        entityId: entity.id,
        title: `${month} audit completed`,
        detail: `${submissions.length} submissions checked; ${findingCount} observation drafts.`,
        kind: "audit",
        createdAt: nowIso,
        acknowledged: false,
      });
      store.event(
        actor.id,
        "audit.completed",
        entity,
        `${month}: ${submissions.length} records; snapshot ${audit.snapshotHash.slice(0, 12)}.`,
      );
      return { ...audit, reused: false };
    }),
  );
}
export function transitionFinding(
  store: WorkspaceStore,
  actor: Actor,
  id: string,
  action: string,
  b: Record<string, unknown>,
  now = new Date(),
) {
  const finding = record(store, actor, "findings", id, "qa_manager");
  const updated = { ...finding };
  if (action === "issue") {
    if (finding.status !== "observation_draft")
      throw new WorkspaceError("Only a draft observation can be issued.", 409);
    updated.status = "observation_issued";
    updated.issuedAt = now.toISOString();
    updated.dueDate = new Date(
      now.getTime() + finding.responseDays * 86400000,
    ).toISOString();
  } else if (action === "ncr") {
    if (
      finding.status !== "observation_issued" ||
      !finding.dueDate ||
      Date.parse(finding.dueDate) >= now.getTime()
    )
      throw new WorkspaceError(
        "An issued observation must pass its response deadline before an NCR draft can be prepared.",
        409,
      );
    updated.status = "ncr_draft";
    updated.ncrDraftAt = now.toISOString();
  } else if (action === "close") {
    if (finding.status === "observation_draft" || finding.status === "closed")
      throw new WorkspaceError("Issue an observation before closing it.", 409);
    updated.closureEvidence = text(b, "closureEvidence", true, 2000);
    updated.status = "closed";
  } else throw new WorkspaceError("Unsupported finding action.", 404);
  store.transaction(() => {
    store.save("findings", updated);
    store.event(
      actor.id,
      `finding.${action}`,
      finding,
      `${finding.status} → ${updated.status}. Official Asite NCR issuance is a separate controlled workflow.`,
    );
  });
  return updated;
}
export function saveLesson(
  store: WorkspaceStore,
  actor: Actor,
  b: Record<string, unknown>,
) {
  const s = scope(store, actor, b),
    source = sourceUrl(text(b, "sourceUrl", true, 2000));
  const lesson: Lesson = {
    ...s,
    id: randomUUID(),
    title: text(b, "title"),
    problem: text(b, "problem", true, 5000),
    lesson: text(b, "lesson", true, 5000),
    recommendation: text(b, "recommendation", true, 5000),
    tags: list(b, "tags"),
    sourceUrl: source,
    sourceRevision: text(b, "sourceRevision", true, 100),
    sourceId: "",
    owner: actor.name,
    status: "draft",
    createdAt: new Date().toISOString(),
    sampleData: false,
  };
  store.transaction(() => {
    store.save("lessons", lesson);
    store.event(
      actor.id,
      "lesson.created",
      lesson,
      `Draft lesson: ${lesson.title}`,
    );
  });
  return lesson;
}
export function approveLesson(store: WorkspaceStore, actor: Actor, id: string) {
  const lesson = record(store, actor, "lessons", id, "reviewer");
  const updated = { ...lesson, status: "approved" as const };
  store.transaction(() => {
    store.save("lessons", updated);
    store.event(actor.id, "lesson.approved", lesson, lesson.title);
  });
  return updated;
}
export function saveRisk(
  store: WorkspaceStore,
  actor: Actor,
  b: Record<string, unknown>,
) {
  const s = scope(store, actor, b),
    likelihood = Number(b.likelihood),
    impact = Number(b.impact),
    processId = identifier(b, "processId", false);
  if (
    ![likelihood, impact].every((v) => Number.isInteger(v) && v >= 1 && v <= 5)
  )
    throw new WorkspaceError(
      "Likelihood and impact must be integers from 1 to 5.",
    );
  if (processId) {
    const p = record(store, actor, "processes", processId);
    if (p.entityId !== s.entityId || p.projectId !== s.projectId)
      throw new WorkspaceError(
        "Choose a technical process in the same project.",
      );
  }
  const risk = {
    ...s,
    id: randomUUID(),
    title: text(b, "title"),
    description: text(b, "description", true, 5000),
    owner: text(b, "owner", false) || actor.name,
    likelihood,
    impact,
    status: "open" as const,
    processId,
    lessonIds: [],
    mitigation: text(b, "mitigation", false, 5000),
    createdAt: new Date().toISOString(),
  };
  store.transaction(() => {
    store.save("risks", risk);
    store.event(actor.id, "risk.created", risk, risk.title);
  });
  return risk;
}
export function linkRisk(
  store: WorkspaceStore,
  actor: Actor,
  id: string,
  lessonId: string,
) {
  const risk = record(store, actor, "risks", id, "contributor"),
    lesson = record(store, actor, "lessons", lessonId);
  if (lesson.status !== "approved")
    throw new WorkspaceError("Only approved lessons can be linked.", 409);
  if (lesson.entityId !== risk.entityId || lesson.projectId !== risk.projectId)
    throw new WorkspaceError(
      "Risk links must use a lesson in the same project.",
      403,
    );
  const updated = {
    ...risk,
    lessonIds: [...new Set([...risk.lessonIds, lessonId])],
  };
  store.transaction(() => {
    store.save("risks", updated);
    store.event(
      actor.id,
      "risk.lesson-linked",
      risk,
      `Linked lesson ${lesson.id}.`,
    );
  });
  return updated;
}
export function saveProcess(
  store: WorkspaceStore,
  actor: Actor,
  b: Record<string, unknown>,
) {
  const s = scope(store, actor, b, "qa_manager");
  const process = {
    ...s,
    id: randomUUID(),
    name: text(b, "name"),
    description: text(b, "description", false, 3000),
  };
  store.save("processes", process);
  store.event(actor.id, "process.created", process, process.name);
  return process;
}
export function saveAccess(
  store: WorkspaceStore,
  actor: Actor,
  b: Record<string, unknown>,
) {
  const s = scope(store, actor, b, "admin"),
    email = text(b, "email", true, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new WorkspaceError("Enter a valid email address.");
  const licenceStatus = b.licenceStatus;
  if (!["unverified", "confirmed", "suspended"].includes(String(licenceStatus)))
    throw new WorkspaceError("Choose a valid licence status.");
  const reference = text(b, "sourceReference", false, 2000);
  if (licenceStatus === "confirmed" && !reference)
    throw new WorkspaceError(
      "Confirmed entitlement requires an evidence/reference.",
    );
  const lastActiveAt = date(b, "lastActiveAt");
  if (lastActiveAt && Date.parse(lastActiveAt) > Date.now())
    throw new WorkspaceError("Last activity cannot be in the future.");
  const activityDates = list(b, "activityDates", 500).map((v) =>
    date({ value: v }, "value", true),
  );
  if (activityDates.some((v) => Date.parse(v) > Date.now()))
    throw new WorkspaceError("Activity events cannot be in the future.");
  if (
    b.activityHistoryComplete !== undefined &&
    typeof b.activityHistoryComplete !== "boolean"
  )
    throw new WorkspaceError("activityHistoryComplete must be true or false.");
  const activityHistoryComplete = b.activityHistoryComplete === true;
  if (activityHistoryComplete && !reference)
    throw new WorkspaceError(
      "Complete activity history requires a source reference.",
    );
  const prior = store
    .all("access")
    .find(
      (a) =>
        a.entityId === s.entityId &&
        a.projectId === s.projectId &&
        a.email === email,
    );
  const access = {
    ...s,
    id: prior?.id || randomUUID(),
    name: text(b, "name"),
    email,
    expected: true,
    licenceStatus: licenceStatus as "unverified" | "confirmed" | "suspended",
    lastActiveAt,
    sourceReference: reference,
    activityDates,
    activityHistoryComplete,
  };
  store.transaction(() => {
    store.save("access", access);
    store.event(
      actor.id,
      "access.recorded",
      access,
      `Entitlement evidence recorded for ${email}; no Asite provisioning performed.`,
    );
  });
  return access;
}
export function saveMembership(
  store: WorkspaceStore,
  actor: Actor,
  b: Record<string, unknown>,
) {
  const s = scope(store, actor, b, "admin", false),
    email = text(b, "email", true, 254).toLowerCase(),
    role = text(b, "role") as Role,
    projectIds = list(b, "projectIds");
  if (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    !["admin", "qa_manager", "reviewer", "contributor", "viewer"].includes(
      role,
    ) ||
    !projectIds.length
  )
    throw new WorkspaceError("Supply a valid email, role and project scope.");
  for (const id of projectIds)
    if (id !== "*" && store.get("projects", id)?.entityId !== s.entityId)
      throw new WorkspaceError(
        "A membership project belongs to another entity.",
      );
  const existing = store
    .all("memberships")
    .find((m) => m.entityId === s.entityId && m.email === email);
  const membership = {
    ...s,
    id: existing?.id || randomUUID(),
    email,
    name: text(b, "name"),
    role,
    projectIds,
    active: true,
  };
  store.transaction(() => {
    store.save("memberships", membership);
    store.event(
      actor.id,
      "membership.saved",
      membership,
      `${email}: ${role}; project scope updated.`,
    );
  });
  return membership;
}
export function revokeMembership(
  store: WorkspaceStore,
  actor: Actor,
  id: string,
) {
  const membership = record(store, actor, "memberships", id, "admin");
  if (membership.email.toLowerCase() === actor.email.toLowerCase())
    throw new WorkspaceError(
      "Ask another authorized administrator to revoke your own access.",
      409,
    );
  store.transaction(() => {
    store.save("memberships", { ...membership, active: false });
    store.event(
      actor.id,
      "membership.revoked",
      membership,
      `Application membership revoked for ${membership.email}.`,
    );
  });
  return { revoked: true };
}
export function refreshAlerts(
  store: WorkspaceStore,
  actor: Actor,
  now = new Date(),
) {
  let count = 0;
  store.transaction(() => {
    for (const s of store
      .all("submissions")
      .filter(
        (s) =>
          may(actor, s, "qa_manager") &&
          s.status !== "submitted" &&
          s.dueDate &&
          Date.parse(s.dueDate) < now.getTime(),
      )) {
      const id = `overdue:${s.id}:${s.dueDate}`;
      if (store.get("alerts", id)) continue;
      store.save("alerts", {
        id,
        entityId: s.entityId,
        projectId: s.projectId,
        title: `Overdue: ${s.documentNo || s.title}`,
        detail: `Owner: ${s.owner}. Due: ${s.dueDate.slice(0, 10)}. Rule-based alert; not a prediction.`,
        kind: "overdue",
        createdAt: now.toISOString(),
        acknowledged: false,
      });
      count++;
    }
  });
  return { created: count };
}
export function acknowledgeAlert(
  store: WorkspaceStore,
  actor: Actor,
  id: string,
) {
  const alert = record(store, actor, "alerts", id, "contributor");
  store.save("alerts", { ...alert, acknowledged: true });
  return { acknowledged: true };
}
export function evidencePack(
  store: WorkspaceStore,
  actor: Actor,
  auditId: string,
) {
  const audit = record(store, actor, "audits", auditId);
  if (
    !actor.grants.some(
      (g) =>
        (g.entityId === "*" || g.entityId === audit.entityId) &&
        g.projectIds.includes("*"),
    )
  )
    throw new WorkspaceError(
      "Entity-wide evidence packs require access to all projects in the entity.",
      403,
    );
  const findings = store
    .all("findings")
    .filter((f) => f.auditId === audit.id && may(actor, f));
  return {
    title: "H.O. Monthly Adoption and Compliance Audit — Evidence Pack",
    status:
      "Draft evidence pack; official NCR issue requires the ECC/Asite approval workflow.",
    audit,
    findings,
    generatedAt: new Date().toISOString(),
  };
}
export function importRecords(
  store: WorkspaceStore,
  actor: Actor,
  b: Record<string, unknown>,
) {
  const s = scope(store, actor, b),
    kind = text(b, "kind"),
    records = b.records;
  if (
    !["submissions", "lessons", "access"].includes(kind) ||
    !Array.isArray(records) ||
    !records.length ||
    records.length > 1000
  )
    throw new WorkspaceError(
      "Import 1–1,000 submission, lesson or access records.",
    );
  return store.transaction(() => {
    let imported = 0;
    for (const row of records) {
      if (!row || typeof row !== "object" || Array.isArray(row))
        throw new WorkspaceError(
          `Import row ${imported + 1} must be an object.`,
        );
      const body = {
        ...(row as Record<string, unknown>),
        ...s,
        id: undefined,
        sourceKind: "import",
      };
      if (kind === "submissions") saveSubmission(store, actor, body);
      if (kind === "lessons") saveLesson(store, actor, body);
      if (kind === "access") saveAccess(store, actor, body);
      imported++;
    }
    store.event(
      actor.id,
      "import.completed",
      s,
      `${imported} ${kind} imported. No external approvals were inferred.`,
    );
    return { imported, kind };
  });
}
