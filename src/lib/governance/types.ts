export type Role =
  "admin" | "qa_manager" | "reviewer" | "contributor" | "viewer";
export type Grant = { entityId: string; projectIds: string[]; role: Role };
export type Actor = {
  id: string;
  name: string;
  email: string;
  grants: Grant[];
  local?: boolean;
};
export type Scope = { id: string; entityId: string; projectId?: string };
export type Entity = Scope & {
  name: string;
  owner: string;
  entitlement: "unverified" | "confirmed";
  entitlementReference: string;
};
export type Project = Scope & {
  name: string;
  asiteWorkspaceId: string;
  code: string;
};
export type RuleProfile = Scope & {
  name: string;
  version: string;
  status: "draft" | "approved";
  approvalReference: string;
  requiredMetadata: string[];
  allowedSuitability: string[];
  requiredChecklist: string[];
  requiredEvidence: string[];
  responseDays: number;
  approvedBy?: string;
  approvedAt?: string;
  minimumAdoptionPercent?: number | null;
};
export type Evidence = {
  id: string;
  kind: string;
  title: string;
  url: string;
  revision: string;
};
export type Submission = Scope & {
  title: string;
  documentNo: string;
  revision: string;
  classification: string;
  discipline: string;
  suitabilityCode: string;
  owner: string;
  ownerId: string;
  dueDate: string;
  submittedAt: string;
  status: "draft" | "submitted";
  checklist: Record<string, boolean>;
  evidence: Evidence[];
  reviewerId: string;
  reviewerName: string;
  reviewedRevision: string;
  createdAt: string;
  sourceKind: "manual" | "import" | "demo";
  sourceReference: string;
};
export type GateIssue = {
  code: string;
  requirement: string;
  actual: string;
  severity: "major" | "minor";
  field: string;
};
export type GateResult = {
  passed: boolean;
  rulesApproved: boolean;
  ruleVersion: string;
  issues: GateIssue[];
};
export type Finding = Scope & {
  auditId: string;
  submissionId: string;
  title: string;
  requirement: string;
  actual: string;
  severity: "major" | "minor";
  status: "observation_draft" | "observation_issued" | "ncr_draft" | "closed";
  evidence: Evidence[];
  ruleVersion: string;
  owner: string;
  createdAt: string;
  responseDays: number;
  issuedAt?: string;
  dueDate?: string;
  ncrDraftAt?: string;
  closureEvidence?: string;
};
export type Audit = Scope & {
  month: string;
  runAt: string;
  actor: string;
  submissionCount: number;
  conformingCount: number;
  findingCount: number;
  sourceCoverage: string;
  snapshotHash: string;
  snapshots: Submission[];
  ruleVersions: string[];
  sampleData: boolean;
  expectedUsers: number;
  monthlyActiveUsers: number;
  adoptionRate: number | null;
  adoptionBasis: string;
  accessSnapshots: AccessRecord[];
};
export type Lesson = Scope & {
  title: string;
  problem: string;
  lesson: string;
  recommendation: string;
  tags: string[];
  sourceUrl: string;
  sourceRevision: string;
  sourceId: string;
  owner: string;
  status: "draft" | "approved";
  createdAt: string;
  sampleData: boolean;
};
export type Risk = Scope & {
  title: string;
  description: string;
  owner: string;
  likelihood: number;
  impact: number;
  status: "open" | "mitigating" | "closed";
  processId: string;
  lessonIds: string[];
  mitigation: string;
  createdAt: string;
};
export type TechnicalProcess = Scope & { name: string; description: string };
export type AccessRecord = Scope & {
  name: string;
  email: string;
  expected: boolean;
  licenceStatus: "unverified" | "confirmed" | "suspended";
  lastActiveAt: string;
  sourceReference: string;
  activityDates?: string[];
  activityHistoryComplete?: boolean;
};
export type Membership = Scope & {
  email: string;
  name: string;
  role: Role;
  projectIds: string[];
  active?: boolean;
};
export type Alert = Scope & {
  title: string;
  detail: string;
  kind: "overdue" | "gate" | "audit";
  createdAt: string;
  acknowledged: boolean;
};
export type SourceDocument = Scope & {
  title: string;
  content: string;
  revision: string;
  sampleData: boolean;
};
export type AuditEvent = Scope & {
  action: string;
  actor: string;
  occurredAt: string;
  summary: string;
};
export type Collections = {
  entities: Entity;
  projects: Project;
  rules: RuleProfile;
  submissions: Submission;
  findings: Finding;
  audits: Audit;
  lessons: Lesson;
  risks: Risk;
  processes: TechnicalProcess;
  access: AccessRecord;
  memberships: Membership;
  alerts: Alert;
  sources: SourceDocument;
  events: AuditEvent;
};
export type Collection = keyof Collections;
export type WorkspaceData = { [K in Collection]: Collections[K][] };
export type WorkspaceSnapshot = WorkspaceData & {
  actor: Actor;
  now: string;
  gateResults: Record<string, GateResult>;
  readiness: {
    asite: boolean;
    nativeGates: boolean;
    powerBi: boolean;
    ai: boolean;
    semantic: boolean;
    scheduler: boolean;
  };
};
export type SearchHit = { lesson: Lesson; score: number; reason: string };
export const COLLECTIONS: Collection[] = [
  "entities",
  "projects",
  "rules",
  "submissions",
  "findings",
  "audits",
  "lessons",
  "risks",
  "processes",
  "access",
  "memberships",
  "alerts",
  "sources",
  "events",
];
