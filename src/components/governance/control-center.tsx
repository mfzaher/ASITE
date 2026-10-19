"use client";

import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  BookOpen,
  Building2,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Cloud,
  Cog,
  FileCheck2,
  FileText,
  FolderOpen,
  GitBranch,
  LayoutDashboard,
  Link2,
  Loader2,
  LockKeyhole,
  LogOut,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  Upload,
  Users,
  X,
} from "lucide-react";
import {
  dueRisk,
  may,
  previousMonth,
  workspaceMetrics,
} from "@/lib/governance/engine";
import type {
  GateResult,
  Lesson,
  RuleProfile,
  SearchHit,
  Submission,
  WorkspaceSnapshot,
} from "@/lib/governance/types";

type Tab =
  | "overview"
  | "audits"
  | "compliance"
  | "gates"
  | "lessons"
  | "risks"
  | "access"
  | "setup";
type Modal =
  | "entity"
  | "project"
  | "submission"
  | "lesson"
  | "risk"
  | "access"
  | "membership"
  | "rules"
  | "import"
  | "process"
  | "closure"
  | null;
type Answer = {
  answer: string;
  mode: string;
  method: string;
  warning: string;
  citations: {
    id: string;
    title: string;
    url: string;
    revision: string;
    sampleData: boolean;
  }[];
};
const NAV = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "audits", label: "Audits & observations", icon: ClipboardCheck },
  { id: "compliance", label: "Information compliance", icon: FileCheck2 },
  { id: "gates", label: "Submission gates", icon: ShieldCheck },
  { id: "lessons", label: "Lessons learned", icon: BookOpen },
  { id: "risks", label: "Risk & technical links", icon: GitBranch },
  { id: "access", label: "Access & adoption", icon: Users },
  { id: "setup", label: "Workspace setup", icon: Cog },
] as const;
const STATUS: Record<string, string> = {
  observation_draft: "Observation draft",
  observation_issued: "Observation issued",
  ncr_draft: "NCR draft",
  closed: "Closed",
  draft: "Draft",
  approved: "Approved",
  submitted: "Submitted",
  unverified: "Unverified",
  confirmed: "Confirmed",
  suspended: "Suspended",
  open: "Open",
  mitigating: "Mitigating",
};
function Badge({ value, label }: { value: string; label?: string }) {
  return (
    <span className={`gc-badge gc-${value}`}>
      {label || STATUS[value] || value}
    </span>
  );
}
function Empty({
  title,
  detail,
  action,
}: {
  title: string;
  detail: string;
  action?: ReactNode;
}) {
  return (
    <div className="gc-empty">
      <FolderOpen size={28} />
      <h3>{title}</h3>
      <p>{detail}</p>
      {action}
    </div>
  );
}
function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="gc-field">
      <span>{label}</span>
      {isValidElement(children)
        ? cloneElement(children as ReactElement<{ "aria-label"?: string }>, {
            "aria-label": label,
          })
        : children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
function day(value?: string) {
  return value
    ? new Intl.DateTimeFormat("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        timeZone: "Asia/Dubai",
      }).format(new Date(value))
    : "Not recorded";
}
function downloadJson(value: unknown, name: string) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function api<T = unknown>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(`/api/control${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const result = await r.json();
  if (!r.ok)
    throw Object.assign(new Error(result.error || "The request failed."), {
      status: r.status,
    });
  return result as T;
}

export default function ControlCenter() {
  const [data, setData] = useState<WorkspaceSnapshot | null>(null),
    [tab, setTab] = useState<Tab>("overview"),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [entityId, setEntityId] = useState(""),
    [projectId, setProjectId] = useState(""),
    [query, setQuery] = useState(""),
    [month, setMonth] = useState(previousMonth());
  const [modal, setModal] = useState<Modal>(null),
    [editing, setEditing] = useState<Submission | null>(null),
    [editingRules, setEditingRules] = useState<RuleProfile | null>(null),
    [findingId, setFindingId] = useState("");
  const [gateId, setGateId] = useState(""),
    [question, setQuestion] = useState(""),
    [answer, setAnswer] = useState<Answer | null>(null),
    [recommendations, setRecommendations] = useState<
      Record<string, { hits: SearchHit[]; method: string; warning: string }>
    >({});
  const [importText, setImportText] = useState(""),
    [importKind, setImportKind] = useState("submissions"),
    [loginNeeded, setLoginNeeded] = useState(false);
  const refresh = useCallback(async () => {
    try {
      setData(await api<WorkspaceSnapshot>("/snapshot"));
      setLoginNeeded(false);
    } catch (e) {
      const err = e as Error & { status?: number };
      if (err.status === 401 || err.status === 403) setLoginNeeded(true);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    if (!modal) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    const elements = () => [
      ...(dialog?.querySelectorAll<HTMLElement>(
        "button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href]",
      ) || []),
    ];
    elements()[0]?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setModal(null);
        return;
      }
      if (event.key !== "Tab") return;
      const candidates = elements(),
        first = candidates[0],
        last = candidates[candidates.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", keyboard);
    return () => {
      document.removeEventListener("keydown", keyboard);
      previous?.focus();
    };
  }, [modal]);
  async function act(path: string, body: unknown = {}, message = "Saved.") {
    setBusy(true);
    setError("");
    try {
      const result = await api(path, body);
      setNotice(message);
      await refresh();
      return result;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  }
  function open(type: Modal) {
    setError("");
    setModal(type);
    if (type !== "submission") setEditing(null);
  }
  const projects = useMemo(
    () =>
      data?.projects.filter((p) => !entityId || p.entityId === entityId) || [],
    [data, entityId],
  );
  const scoped = useMemo(() => {
    if (!data) return null;
    const within = (s: { entityId: string; projectId?: string }) =>
      (!entityId || s.entityId === entityId) &&
      (!projectId || s.projectId === projectId);
    return {
      ...data,
      submissions: data.submissions.filter(within),
      findings: data.findings.filter(within),
      audits: data.audits.filter((a) => !entityId || a.entityId === entityId),
      lessons: data.lessons.filter(within),
      risks: data.risks.filter(within),
      access: data.access.filter(within),
      alerts: data.alerts.filter(within),
      processes: data.processes.filter(within),
    };
  }, [data, entityId, projectId]);
  const metrics = scoped ? workspaceMetrics(scoped) : null;
  const visibleSubmissions =
    scoped?.submissions.filter((s) =>
      `${s.title} ${s.documentNo} ${s.discipline} ${s.owner}`
        .toLowerCase()
        .includes(query.toLowerCase()),
    ) || [];
  const selectedGate =
    visibleSubmissions.find((s) => s.id === gateId) || visibleSubmissions[0];
  const admin = !!data?.actor.grants.some((g) => g.role === "admin"),
    qa = !!data?.actor.grants.some((g) =>
      ["admin", "qa_manager"].includes(g.role),
    );
  const actor = data?.actor;
  const sample = !!scoped?.submissions.some((s) => s.sourceKind === "demo");
  const evidenceKinds = [
    ...new Set(
      data?.rules.flatMap((r) => r.requiredEvidence) || [
        "checklist",
        "benchmark",
      ],
    ),
  ];
  const projectName = (id?: string) =>
    data?.projects.find((p) => p.id === id)?.name || "Entity-wide";
  const entityName = (id: string) =>
    data?.entities.find((e) => e.id === id)?.name || id;
  const exportUrl = (table: string) =>
    `/api/control/export?${new URLSearchParams({ table, ...(entityId ? { entity: entityId } : {}), ...(projectId && table !== "audits" ? { project: projectId } : {}) })}`;
  async function saveForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget),
      values = Object.fromEntries(form.entries()) as Record<string, string>;
    const project = data?.projects.find((p) => p.id === values.projectId),
      body: Record<string, unknown> = {
        ...values,
        entityId: project?.entityId || values.entityId || entityId,
        projectId: values.projectId || undefined,
      };
    let path = "";
    if (modal === "entity") path = "/entities";
    if (modal === "project") path = "/projects";
    if (modal === "submission") {
      path = "/submissions";
      body.id = editing?.id;
      body.checklist = Object.fromEntries(
        (
          data?.rules.find(
            (r) =>
              r.projectId === project?.id && r.entityId === project?.entityId,
          ) ||
          data?.rules.find(
            (r) => r.entityId === project?.entityId && !r.projectId,
          )
        )?.requiredChecklist.map((k) => [k, form.get(k) === "on"]) || [],
      );
      body.evidence = evidenceKinds
        .filter((k) => values[`${k}Url`])
        .map((kind) => ({
          kind,
          title: `${kind} evidence`,
          url: values[`${kind}Url`],
          revision: values[`${kind}Revision`] || values.revision,
        }));
    }
    if (modal === "lesson") {
      path = "/lessons";
      body.tags = (values.tags || "")
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean);
    }
    if (modal === "risk") {
      path = "/risks";
      body.likelihood = Number(values.likelihood);
      body.impact = Number(values.impact);
    }
    if (modal === "process") path = "/processes";
    if (modal === "access") path = "/access";
    if (modal === "membership") {
      path = "/memberships";
      body.projectIds = (values.projectIds || "*")
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean);
      delete body.projectId;
    }
    if (modal === "rules") {
      path = "/rules";
      body.entityId =
        editingRules?.entityId || entityId || data?.entities[0]?.id;
      body.projectId = editingRules?.projectId;
      body.responseDays = Number(values.responseDays);
      for (const key of [
        "requiredMetadata",
        "requiredChecklist",
        "requiredEvidence",
        "allowedSuitability",
      ])
        body[key] = (values[key] || "")
          .split(",")
          .map((v) => v.trim())
          .filter(Boolean);
    }
    if (modal === "closure") {
      path = `/findings/${findingId}/close`;
    }
    if (modal === "import") {
      path = "/imports";
      try {
        const input = JSON.parse(importText);
        body.records = Array.isArray(input) ? input : input.records;
        body.kind = importKind;
      } catch {
        setError("Choose a valid JSON file or paste a JSON array.");
        return;
      }
    }
    const result = await act(
      path,
      body,
      modal === "submission"
        ? "Draft saved. Reviewer approval is required before submission."
        : "Record saved.",
    );
    if (result) {
      setModal(null);
      setEditing(null);
    }
  }
  async function ask(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      setAnswer(
        await api<Answer>("/ask", { query: question, entityId, projectId }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function recommend(id: string) {
    setBusy(true);
    setError("");
    try {
      const result = await api<{
        hits: SearchHit[];
        method: string;
        warning: string;
      }>(`/risks/${id}/recommend`, {});
      setRecommendations((prev) => ({ ...prev, [id]: result }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/auth/sign-in/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: fields.get("email"),
          password: fields.get("password"),
        }),
      });
      const result = await r.json();
      if (!r.ok)
        throw new Error(result.message || result.error || "Sign-in failed.");
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (loading)
    return (
      <div className="gc-loading">
        <Loader2 className="gc-spin" />
        <p>Opening the governance workspace…</p>
      </div>
    );
  if (!data)
    return (
      <main className="gc-signin">
        <div className="gc-logo">
          ECC<span>Information governance</span>
        </div>
        <h1>Your quality workspace</h1>
        <p>
          Sign in with an account provisioned by your workspace administrator.
        </p>
        {error && (
          <div className="gc-message gc-error" role="alert">
            {error}
          </div>
        )}
        <form onSubmit={signIn}>
          <Field label="Email">
            <input type="email" name="email" required autoComplete="username" />
          </Field>
          <Field label="Password">
            <input
              type="password"
              name="password"
              required
              autoComplete="current-password"
            />
          </Field>
          <button className="gc-primary" disabled={busy}>
            {busy ? (
              <Loader2 className="gc-spin" size={16} />
            ) : (
              <LockKeyhole size={16} />
            )}
            Sign in
          </button>
        </form>
        <small>
          {loginNeeded
            ? "No account? The administrator can provision one using the setup command."
            : "Complete workspace setup if authentication has not been configured."}
        </small>
      </main>
    );
  const contentTitle = NAV.find((n) => n.id === tab)!.label;
  const addButton = (type: Modal, label: string) => (
    <button className="gc-primary" onClick={() => open(type)} disabled={busy}>
      <Plus size={16} />
      {label}
    </button>
  );
  return (
    <div className="gc-shell">
      <aside className="gc-sidebar">
        <a className="gc-logo" href="/">
          ECC<span>Information governance</span>
        </a>
        <div className="gc-workspace-mark">
          <Building2 size={17} />
          <div>
            Head Office<small>Quality & technical operations</small>
          </div>
          <Badge value="draft" label="V1" />
        </div>
        <p className="gc-nav-label">WORKSPACE</p>
        <nav aria-label="Workspace navigation">
          {NAV.map((n) => (
            <button
              key={n.id}
              onClick={() => {
                setTab(n.id);
                setQuery("");
              }}
              className={tab === n.id ? "active" : ""}
            >
              <n.icon size={18} />
              {n.label}
              {n.id === "audits" && !!metrics?.openFindings && (
                <span className="gc-nav-count">{metrics.openFindings}</span>
              )}
            </button>
          ))}
        </nav>
        <a className="gc-register-link" href="/registers">
          <FolderOpen size={17} />
          <span>
            Drawing register studio<small>Existing Asite connection</small>
          </span>
          <ArrowRight size={15} />
        </a>
        <div className="gc-sidebar-bottom">
          <span className="gc-avatar">
            {actor?.name
              .split(" ")
              .map((x) => x[0])
              .join("")
              .slice(0, 2)}
          </span>
          <div>
            {actor?.name}
            <small>
              {actor?.local
                ? "Local workspace owner"
                : "Authorized workspace member"}
            </small>
          </div>
          {!actor?.local && (
            <button
              aria-label="Sign out"
              onClick={async () => {
                await fetch("/api/auth/sign-out", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: "{}",
                });
                setData(null);
              }}
            >
              <LogOut size={17} />
            </button>
          )}
        </div>
      </aside>
      <div className="gc-main">
        <header className="gc-topbar">
          <div>
            <span>Head Office</span>
            <ChevronRight size={13} />
            <strong>{contentTitle}</strong>
          </div>
          <div>
            <span className="gc-live-dot" />
            {actor?.local ? "Local sandbox" : "Secure workspace"}
            <button
              className="gc-icon"
              aria-label="Refresh workspace"
              onClick={() => void refresh()}
            >
              <RefreshCw size={15} />
            </button>
          </div>
        </header>
        <main className="gc-content">
          <div className="gc-page-heading">
            <div>
              <p className="gc-eyebrow">
                ECC · QUALITY & INFORMATION GOVERNANCE
              </p>
              <h1>
                {tab === "overview" ? "Quality, connected." : contentTitle}
              </h1>
              <p>
                {
                  {
                    overview:
                      "A clear view of adoption, compliance and the actions that need your attention.",
                    audits:
                      "Monthly evidence snapshots, observations and controlled escalation.",
                    compliance:
                      "Check information against the approved requirements for each project.",
                    gates:
                      "Complete the checklist. Match the evidence. Record independent approval.",
                    lessons:
                      "Find the right lesson, with the source behind every recommendation.",
                    risks:
                      "Connect project risks and technical processes to relevant experience.",
                    access:
                      "Track entitlement evidence, expected users and measured adoption.",
                    setup:
                      "Configure the workspace and prepare each connection for rollout.",
                  }[tab]
                }
              </p>
            </div>
            <div className="gc-heading-actions">
              {sample && <Badge value="demo" label="Fictional sample data" />}
              {tab !== "setup" && (
                <button
                  className="gc-secondary"
                  onClick={() => open("import")}
                  disabled={!data.projects.length}
                >
                  <Upload size={16} />
                  Import records
                </button>
              )}
            </div>
          </div>
          {error && (
            <div className="gc-message gc-error" role="alert">
              <TriangleAlert size={17} />
              <span>{error}</span>
              <button aria-label="Dismiss error" onClick={() => setError("")}>
                <X size={15} />
              </button>
            </div>
          )}
          {notice && (
            <div className="gc-message gc-success" role="status">
              <CheckCircle2 size={17} />
              <span>{notice}</span>
              <button
                aria-label="Dismiss notification"
                onClick={() => setNotice("")}
              >
                <X size={15} />
              </button>
            </div>
          )}
          {actor?.local && (
            <div className="gc-local-note">
              <LockKeyhole size={14} />
              Single-user development mode. Use authenticated accounts before
              connecting company data or hosting the application.
            </div>
          )}
          <section className="gc-filterbar" aria-label="Workspace filters">
            <div>
              <Building2 size={15} />
              <select
                aria-label="Filter by entity"
                value={entityId}
                onChange={(e) => {
                  setEntityId(e.target.value);
                  setProjectId("");
                  setAnswer(null);
                }}
              >
                <option value="">All permitted entities</option>
                {data.entities.map((e) => (
                  <option value={e.id} key={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <FolderOpen size={15} />
              <select
                aria-label="Filter by project"
                value={projectId}
                onChange={(e) => {
                  setProjectId(e.target.value);
                  setAnswer(null);
                }}
              >
                <option value="">All permitted projects</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <label className="gc-search">
              <Search size={15} />
              <input
                aria-label="Search submissions"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search submissions, owner or discipline…"
              />
            </label>
            <span className="gc-filter-count">
              {scoped?.submissions.length || 0} submissions
            </span>
          </section>
          {tab === "overview" && (
            <>
              {!data.entities.length && (
                <div className="gc-welcome">
                  <div>
                    <span className="gc-section-kicker">
                      YOUR WORKSPACE IS READY
                    </span>
                    <h2>Bring your projects into one view.</h2>
                    <p>
                      Create an entity and project to start with your records,
                      or explore all six workflows using clearly labelled
                      fictional data.
                    </p>
                    <div className="gc-button-row">
                      {admin && addButton("entity", "Create first entity")}
                      <button
                        className="gc-secondary"
                        disabled={busy}
                        onClick={() =>
                          void act(
                            "/demo",
                            {},
                            "Fictional demonstration records loaded.",
                          )
                        }
                      >
                        Explore sample workspace
                        <ArrowRight size={16} />
                      </button>
                    </div>
                  </div>
                  <div className="gc-welcome-symbol">
                    <ShieldCheck size={54} />
                  </div>
                </div>
              )}
              <div className="gc-stats">
                {[
                  {
                    label: "Gate compliance",
                    value:
                      metrics?.compliance === null
                        ? "—"
                        : `${metrics?.compliance || 0}%`,
                    detail: `${metrics?.passed || 0} of ${metrics?.total || 0} submissions pass`,
                    icon: ShieldCheck,
                    tone: "green",
                  },
                  {
                    label: "Overdue submissions",
                    value: metrics?.overdue || 0,
                    detail: "Against recorded due dates",
                    icon: CalendarDays,
                    tone: "orange",
                  },
                  {
                    label: "Open observations",
                    value: metrics?.openFindings || 0,
                    detail: "Includes drafts and NCR drafts",
                    icon: ClipboardCheck,
                    tone: "blue",
                  },
                  {
                    label: "30-day adoption",
                    value:
                      metrics?.adoption === null
                        ? "—"
                        : `${metrics?.adoption || 0}%`,
                    detail: `${metrics?.activeUsers || 0} active / ${metrics?.expectedUsers || 0} expected roster entries`,
                    icon: Users,
                    tone: "purple",
                  },
                ].map((m) => (
                  <article className="gc-stat" key={m.label}>
                    <div>
                      <span>{m.label}</span>
                      <m.icon size={18} className={`gc-tone-${m.tone}`} />
                    </div>
                    <strong>{m.value}</strong>
                    <p>{m.detail}</p>
                  </article>
                ))}
              </div>
              <div className="gc-two-col">
                <section className="gc-panel">
                  <div className="gc-panel-head">
                    <div>
                      <span className="gc-section-kicker">
                        INFORMATION HEALTH
                      </span>
                      <h2>Compliance by project</h2>
                    </div>
                    <button
                      className="gc-text-button"
                      onClick={() => setTab("compliance")}
                    >
                      View records
                      <ArrowRight size={14} />
                    </button>
                  </div>
                  {projects.length ? (
                    projects
                      .filter((p) => !projectId || p.id === projectId)
                      .map((p) => {
                        const submissions =
                            scoped?.submissions.filter(
                              (s) => s.projectId === p.id,
                            ) || [],
                          passed = submissions.filter(
                            (s) => data.gateResults[s.id]?.passed,
                          ).length,
                          pct = submissions.length
                            ? (100 * passed) / submissions.length
                            : 0;
                        return (
                          <div className="gc-project-bar" key={p.id}>
                            <div>
                              <strong>{p.name}</strong>
                              <span>
                                {passed}/{submissions.length} pass
                              </span>
                            </div>
                            <div className="gc-bar-track">
                              <i style={{ width: `${pct}%` }} />
                            </div>
                            <small>{entityName(p.entityId)}</small>
                          </div>
                        );
                      })
                  ) : (
                    <Empty
                      title="No project data yet"
                      detail="Create a project, then import or add submission records."
                    />
                  )}
                </section>
                <section className="gc-panel">
                  <div className="gc-panel-head">
                    <div>
                      <span className="gc-section-kicker">ACTION QUEUE</span>
                      <h2>Upcoming & overdue</h2>
                    </div>
                    <button
                      className="gc-text-button"
                      onClick={() =>
                        void act(
                          "/alerts",
                          {},
                          "Overdue alert queue refreshed.",
                        )
                      }
                    >
                      Refresh
                      <RefreshCw size={14} />
                    </button>
                  </div>
                  {scoped?.submissions
                    .filter((s) => s.status !== "submitted")
                    .sort((a, b) =>
                      (a.dueDate || "z").localeCompare(b.dueDate || "z"),
                    )
                    .slice(0, 5)
                    .map((s) => {
                      const risk = dueRisk(s);
                      return (
                        <button
                          className="gc-action-row"
                          key={s.id}
                          onClick={() => {
                            setGateId(s.id);
                            setTab("gates");
                          }}
                        >
                          <span className={`gc-action-dot gc-${risk.level}`} />
                          <div>
                            <strong>{s.documentNo || s.title}</strong>
                            <small>
                              {s.owner} · {day(s.dueDate)}
                            </small>
                          </div>
                          <Badge value={risk.level} label={risk.label} />
                          <ChevronRight size={15} />
                        </button>
                      );
                    })}
                  {!scoped?.submissions.some(
                    (s) => s.status !== "submitted",
                  ) && (
                    <Empty
                      title="No pending submissions"
                      detail="Pending records appear here when they are added."
                    />
                  )}
                </section>
              </div>
              <div className="gc-section-title">
                <div>
                  <span className="gc-section-kicker">
                    ONE PROGRAMME, SIX WORKSTREAMS
                  </span>
                  <h2>Your governance workspace</h2>
                </div>
                <span>Accountable owner · M. Zaher</span>
              </div>
              <div className="gc-workstreams">
                {[
                  {
                    tab: "audits",
                    n: "01",
                    title: "H.O. monthly audits",
                    description:
                      "Review adoption and evidence. Issue observations before preparing NCR drafts.",
                    icon: ClipboardCheck,
                    ready: !!data.audits.length,
                  },
                  {
                    tab: "compliance",
                    n: "02",
                    title: "ISO information controls",
                    description:
                      "Version project metadata requirements and report on missing information.",
                    icon: FileCheck2,
                    ready: data.rules.some((r) => r.status === "approved"),
                  },
                  {
                    tab: "gates",
                    n: "03",
                    title: "Mandatory QA/QC gates",
                    description:
                      "Check evidence, revision alignment and independent approvals.",
                    icon: ShieldCheck,
                    ready: !!data.submissions.length,
                  },
                  {
                    tab: "lessons",
                    n: "04",
                    title: "Lessons learned hub",
                    description:
                      "Retrieve approved project cases with source links and revisions.",
                    icon: BookOpen,
                    ready: !!data.lessons.length,
                  },
                  {
                    tab: "risks",
                    n: "05",
                    title: "Risk & technical links",
                    description:
                      "Recommend relevant lessons and attach them to project risk records.",
                    icon: GitBranch,
                    ready: !!data.risks.length,
                  },
                  {
                    tab: "access",
                    n: "06",
                    title: "Access & adoption",
                    description:
                      "Monitor entitlement evidence and usage across the expected roster.",
                    icon: Users,
                    ready: !!data.access.length,
                  },
                ].map((w) => (
                  <button
                    className="gc-workstream"
                    key={w.n}
                    onClick={() => setTab(w.tab as Tab)}
                  >
                    <div>
                      <w.icon size={21} />
                      <span>{w.n}</span>
                    </div>
                    <h3>{w.title}</h3>
                    <p>{w.description}</p>
                    <footer>
                      <span className={w.ready ? "gc-ready" : ""}>
                        {w.ready ? "Records available" : "Ready for setup"}
                      </span>
                      <ArrowRight size={17} />
                    </footer>
                  </button>
                ))}
              </div>
            </>
          )}
          {tab === "audits" && (
            <>
              <div className="gc-toolbar">
                <div>
                  <CalendarDays size={17} />
                  <input
                    aria-label="Audit month"
                    type="month"
                    max={previousMonth()}
                    value={month}
                    onChange={(e) => setMonth(e.target.value)}
                  />
                  <span>Cutoff · Asia/Dubai</span>
                </div>
                <button
                  className="gc-primary"
                  disabled={busy || !qa || !data.entities.length}
                  onClick={() =>
                    void act(
                      "/audits",
                      { month },
                      "Monthly audit snapshots prepared. Existing monthly runs were retained.",
                    )
                  }
                >
                  <ClipboardCheck size={16} />
                  Run monthly audit
                </button>
              </div>
              <div className="gc-info">
                <FileText size={19} />
                <div>
                  <strong>Observation first. Evidence at every step.</strong>
                  <p>
                    Audits freeze the supplied records into a hashed evidence
                    snapshot. Observation issue is recorded in this workspace;
                    overdue observations can become NCR drafts. Official Asite
                    NCR issue remains a controlled tenant workflow.
                  </p>
                </div>
              </div>
              <section className="gc-panel">
                <div className="gc-panel-head">
                  <h2>Audit runs</h2>
                  <span>{scoped?.audits.length} runs</span>
                </div>
                {scoped?.audits.length ? (
                  <div className="gc-table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Period / entity</th>
                          <th>Observed</th>
                          <th>Conforming</th>
                          <th>Findings</th>
                          <th>Monthly adoption</th>
                          <th>Evidence</th>
                        </tr>
                      </thead>
                      <tbody>
                        {scoped.audits.map((a) => (
                          <tr key={a.id}>
                            <td>
                              <strong>{a.month}</strong>
                              <small>{entityName(a.entityId)}</small>
                              {a.sampleData && (
                                <Badge value="demo" label="Sample" />
                              )}
                            </td>
                            <td>
                              {day(a.runAt)}
                              <small>{a.submissionCount} source records</small>
                            </td>
                            <td>
                              {a.conformingCount}/{a.submissionCount}
                            </td>
                            <td>{a.findingCount}</td>
                            <td>
                              {a.adoptionRate === null
                                ? "History needed"
                                : `${a.adoptionRate}%`}
                              <small>
                                {a.monthlyActiveUsers}/{a.expectedUsers}{" "}
                                observed active
                              </small>
                            </td>
                            <td>
                              <a
                                className="gc-text-button"
                                href={`/api/control/audits/${encodeURIComponent(a.id)}/pack`}
                              >
                                <ArrowDownToLine size={14} />
                                Evidence pack
                              </a>
                              <small>
                                SHA256 · {a.snapshotHash.slice(0, 10)}
                              </small>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <Empty
                    title="Your first audit starts here"
                    detail="Approve the project requirements, import records, then choose an audit month."
                  />
                )}
              </section>
              <div className="gc-section-title">
                <h2>Observations & NCR drafts</h2>
                <span>
                  Automatic escalation requires an issued observation and an
                  elapsed deadline.
                </span>
              </div>
              <div className="gc-findings">
                {scoped?.findings.map((f) => (
                  <article className="gc-panel" key={f.id}>
                    <div className="gc-panel-head">
                      <div>
                        <Badge
                          value={f.severity}
                          label={f.severity.toUpperCase()}
                        />
                        <h3>{f.title}</h3>
                        <small>
                          {projectName(f.projectId)} · Rules v{f.ruleVersion}
                        </small>
                      </div>
                      <Badge value={f.status} />
                    </div>
                    <details>
                      <summary>Requirement and objective evidence</summary>
                      <h4>Requirement</h4>
                      <p className="gc-prewrap">{f.requirement}</p>
                      <h4>Observed gap</h4>
                      <p className="gc-prewrap">{f.actual}</p>
                      {f.evidence.map((e) => (
                        <a
                          className="gc-source-link"
                          href={e.url}
                          target="_blank"
                          rel="noreferrer"
                          key={e.id}
                        >
                          <Link2 size={13} />
                          {e.title} · {e.revision}
                        </a>
                      ))}
                    </details>
                    <footer className="gc-card-footer">
                      <span>
                        {f.dueDate
                          ? `Response due ${day(f.dueDate)}`
                          : `Owner · ${f.owner}`}
                      </span>
                      <div>
                        {f.status === "observation_draft" && (
                          <button
                            className="gc-secondary"
                            disabled={busy || !qa}
                            onClick={() =>
                              void act(
                                `/findings/${f.id}/issue`,
                                {},
                                "Observation issued in the workspace; response deadline recorded.",
                              )
                            }
                          >
                            Issue observation
                          </button>
                        )}
                        {f.status === "observation_issued" && (
                          <button
                            className="gc-secondary"
                            disabled={
                              busy ||
                              !qa ||
                              !f.dueDate ||
                              Date.parse(f.dueDate) >= Date.now()
                            }
                            onClick={() =>
                              void act(
                                `/findings/${f.id}/ncr`,
                                {},
                                "NCR draft prepared for the authorized ECC/Asite issue process.",
                              )
                            }
                          >
                            Prepare NCR draft
                          </button>
                        )}
                        {["observation_issued", "ncr_draft"].includes(
                          f.status,
                        ) && (
                          <button
                            className="gc-text-button"
                            disabled={!qa}
                            onClick={() => {
                              setFindingId(f.id);
                              open("closure");
                            }}
                          >
                            Record closure
                          </button>
                        )}
                      </div>
                    </footer>
                  </article>
                ))}
              </div>
            </>
          )}
          {tab === "compliance" && (
            <>
              <div className="gc-toolbar">
                <p>
                  Project requirements determine the checks; no universal naming
                  or status codes are assumed.
                </p>
                <a className="gc-secondary" href={exportUrl("submissions")}>
                  <ArrowDownToLine size={15} />
                  Export compliance CSV
                </a>
              </div>
              <section className="gc-panel">
                <div className="gc-panel-head">
                  <h2>Information register</h2>
                  {addButton("submission", "Add submission")}
                </div>
                {visibleSubmissions.length ? (
                  <div className="gc-table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Information container</th>
                          <th>Project / discipline</th>
                          <th>Revision / suitability</th>
                          <th>Gate checks</th>
                          <th>Due date</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleSubmissions.map((s) => (
                          <tr key={s.id}>
                            <td>
                              <button
                                className="gc-cell-link"
                                onClick={() => {
                                  setGateId(s.id);
                                  setTab("gates");
                                }}
                              >
                                {s.documentNo || "Document number needed"}
                              </button>
                              <small>{s.title}</small>
                            </td>
                            <td>
                              {projectName(s.projectId)}
                              <small>
                                {s.discipline || "Missing discipline"}
                              </small>
                            </td>
                            <td>
                              {s.revision || "Missing revision"}
                              <small>
                                {s.suitabilityCode || "Missing suitability"}
                              </small>
                            </td>
                            <td>
                              <Badge
                                value={
                                  data.gateResults[s.id]?.passed
                                    ? "approved"
                                    : "draft"
                                }
                                label={
                                  data.gateResults[s.id]?.passed
                                    ? "Pass"
                                    : `${data.gateResults[s.id]?.issues.length || 0} gaps`
                                }
                              />
                            </td>
                            <td>
                              {day(s.dueDate)}
                              <small>{s.owner}</small>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <Empty
                    title="No matching submissions"
                    detail="Add a draft or import normalized source records."
                  />
                )}
              </section>
              <div className="gc-section-title">
                <h2>Versioned rule profiles</h2>
                <span>Approved project procedures supply the criteria.</span>
              </div>
              <div className="gc-two-col">
                {data.rules
                  .filter((r) => !entityId || r.entityId === entityId)
                  .map((r) => (
                    <article className="gc-panel" key={r.id}>
                      <div className="gc-panel-head">
                        <div>
                          <h3>{r.name}</h3>
                          <small>
                            {entityName(r.entityId)} ·{" "}
                            {r.projectId
                              ? projectName(r.projectId)
                              : "All entity projects"}{" "}
                            · v{r.version}
                          </small>
                        </div>
                        <Badge value={r.status} />
                      </div>
                      <p>{r.requiredMetadata.join(" · ")}</p>
                      <p className="gc-muted">
                        {r.approvalReference ||
                          "An approved procedure/reference is required before activation."}
                      </p>
                      <footer className="gc-card-footer">
                        <span>
                          {r.requiredChecklist.length} checks ·{" "}
                          {r.requiredEvidence.length} evidence types
                        </span>
                        <div>
                          <button
                            className="gc-secondary"
                            disabled={!qa}
                            onClick={() => {
                              setEditingRules(r);
                              open("rules");
                            }}
                          >
                            Edit profile
                          </button>
                          {r.status === "draft" && (
                            <button
                              className="gc-primary"
                              disabled={busy || !qa || !r.approvalReference}
                              onClick={() =>
                                void act(
                                  `/rules/${r.id}/approve`,
                                  {},
                                  "Rule profile approved for local workspace enforcement.",
                                )
                              }
                            >
                              Approve profile
                            </button>
                          )}
                        </div>
                      </footer>
                    </article>
                  ))}
              </div>
            </>
          )}
          {tab === "gates" && (
            <>
              <div className="gc-info">
                <ShieldCheck size={20} />
                <div>
                  <strong>
                    Workspace gate enforced · native Asite enforcement pending
                  </strong>
                  <p>
                    This application blocks its own submission action until the
                    approved checklist, evidence and independent review pass.
                    Deploy the same controls in the tenant’s native Asite
                    workflow before enabling live release.
                  </p>
                </div>
              </div>
              <div className="gc-gates-layout">
                <section className="gc-panel gc-gate-list">
                  <div className="gc-panel-head">
                    <h2>Submission queue</h2>
                    <button
                      className="gc-icon"
                      aria-label="Add submission"
                      onClick={() => {
                        setEditing(null);
                        open("submission");
                      }}
                    >
                      <Plus size={18} />
                    </button>
                  </div>
                  {visibleSubmissions.map((s) => (
                    <button
                      className={`gc-gate-item ${selectedGate?.id === s.id ? "selected" : ""}`}
                      key={s.id}
                      onClick={() => setGateId(s.id)}
                    >
                      <FileText size={20} />
                      <div>
                        <strong>{s.documentNo || s.title}</strong>
                        <small>
                          {s.discipline} · {s.revision || "Revision needed"}
                        </small>
                      </div>
                      <Badge
                        value={
                          data.gateResults[s.id]?.passed ? "approved" : "draft"
                        }
                        label={
                          data.gateResults[s.id]?.passed ? "Pass" : "Review"
                        }
                      />
                    </button>
                  ))}
                </section>
                <section className="gc-panel">
                  {selectedGate ? (
                    <GateDetail
                      submission={selectedGate}
                      result={data.gateResults[selectedGate.id]}
                      project={projectName(selectedGate.projectId)}
                      busy={busy}
                      actorId={data.actor.id}
                      canReview={may(data.actor, selectedGate, "reviewer")}
                      onEdit={() => {
                        setEditing(selectedGate);
                        open("submission");
                      }}
                      onReview={() =>
                        void act(
                          `/submissions/${selectedGate.id}/review`,
                          {},
                          "Independent review recorded for this revision.",
                        )
                      }
                      onSubmit={() =>
                        void act(
                          `/submissions/${selectedGate.id}/submit`,
                          {},
                          "Submitted through the local workspace gate. No native Asite publication was performed.",
                        )
                      }
                    />
                  ) : (
                    <Empty
                      title="No submission selected"
                      detail="Add a submission to see its mandatory checks."
                    />
                  )}
                </section>
              </div>
            </>
          )}
          {tab === "lessons" && (
            <>
              <div className="gc-assistant">
                <div className="gc-assistant-heading">
                  <span>
                    <Sparkles size={23} />
                  </span>
                  <div>
                    <p className="gc-section-kicker">LESSONS ASSISTANT</p>
                    <h2>What can we learn before we proceed?</h2>
                    <p>
                      {data.readiness.ai
                        ? "Grounded AI answers with source references."
                        : "Search approved cases and read source excerpts. AI synthesis can be configured in setup."}
                    </p>
                  </div>
                  <Badge value="approved" label="Permission scoped" />
                </div>
                <form className="gc-ask-form" onSubmit={ask}>
                  <Search size={18} />
                  <input
                    aria-label="Ask the lessons assistant"
                    placeholder="e.g. How can we avoid facade bracket coordination issues?"
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    required
                  />
                  <button
                    className="gc-primary"
                    disabled={busy || !question.trim()}
                  >
                    Find lessons
                    <ArrowRight size={15} />
                  </button>
                </form>
                {answer && (
                  <div className="gc-answer" aria-live="polite">
                    <div>
                      <Badge
                        value="draft"
                        label={
                          answer.mode === "ai-grounded"
                            ? "AI synthesis"
                            : "Source excerpts"
                        }
                      />
                      <Badge
                        value="draft"
                        label={
                          answer.method === "hybrid"
                            ? "Hybrid retrieval"
                            : "Keyword retrieval"
                        }
                      />
                    </div>
                    <p className="gc-prewrap">{answer.answer}</p>
                    {answer.warning && <small>{answer.warning}</small>}
                    <div className="gc-citations">
                      {answer.citations.map((c) => (
                        <a
                          key={c.id}
                          href={c.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <span>{c.id}</span>
                          {c.title}
                          <small>
                            Revision {c.revision}
                            {c.sampleData ? " · Fictional case" : ""}
                          </small>
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <div className="gc-section-title">
                <div>
                  <h2>Project knowledge library</h2>
                  <span>
                    {scoped?.lessons.length} visible lessons · draft cases
                    require review
                  </span>
                </div>
                {addButton("lesson", "Capture a lesson")}
              </div>
              <div className="gc-lesson-grid">
                {scoped?.lessons.map((l) => (
                  <article className="gc-panel gc-lesson" key={l.id}>
                    <div className="gc-panel-head">
                      <BookOpen size={21} />
                      <Badge value={l.status} />
                    </div>
                    <h3>{l.title}</h3>
                    <p>{l.problem}</p>
                    <div className="gc-tags">
                      {l.tags.map((t) => (
                        <span key={t}>{t}</span>
                      ))}
                    </div>
                    <details>
                      <summary>Lesson and recommended action</summary>
                      <p>{l.lesson}</p>
                      <p>
                        <strong>Action:</strong> {l.recommendation}
                      </p>
                    </details>
                    <footer>
                      <a
                        className="gc-source-link"
                        href={
                          l.sourceUrl || `/api/control/evidence/${l.sourceId}`
                        }
                        target="_blank"
                        rel="noreferrer"
                      >
                        <Link2 size={13} />
                        Source · {l.sourceRevision}
                      </a>
                      {l.status === "draft" &&
                        may(data.actor, l, "reviewer") && (
                          <button
                            className="gc-text-button"
                            disabled={busy}
                            onClick={() =>
                              void act(
                                `/lessons/${l.id}/approve`,
                                {},
                                "Lesson approved for retrieval.",
                              )
                            }
                          >
                            Approve lesson
                            <Check size={14} />
                          </button>
                        )}
                    </footer>
                    <small>
                      {projectName(l.projectId)}
                      {l.sampleData ? " · Fictional training case" : ""}
                    </small>
                  </article>
                ))}
              </div>
              {!scoped?.lessons.length && (
                <Empty
                  title="Start capturing project experience"
                  detail="Record a lesson with its CDE source link and revision. Approved cases become searchable."
                />
              )}
            </>
          )}
          {tab === "risks" && (
            <>
              <div className="gc-toolbar">
                <p>
                  Working matrix: likelihood × impact (1–5 each). Align the
                  scoring policy with ECC before rollout.
                </p>
                <div className="gc-button-row">
                  <button
                    className="gc-secondary"
                    onClick={() => open("process")}
                  >
                    Add technical process
                  </button>
                  {addButton("risk", "Add risk")}
                </div>
              </div>
              <div className="gc-risk-grid">
                {scoped?.risks.map((r) => (
                  <article className="gc-panel gc-risk" key={r.id}>
                    <div className="gc-panel-head">
                      <div
                        className={`gc-risk-score ${r.likelihood * r.impact >= 12 ? "gc-high" : "gc-medium"}`}
                      >
                        <strong>{r.likelihood * r.impact}</strong>
                        <small>
                          {r.likelihood} × {r.impact}
                        </small>
                      </div>
                      <div>
                        <Badge value={r.status} />
                        <small>{projectName(r.projectId)}</small>
                      </div>
                    </div>
                    <h3>{r.title}</h3>
                    <p>{r.description}</p>
                    <div className="gc-risk-meta">
                      <span>
                        <Users size={14} />
                        {r.owner}
                      </span>
                      <span>
                        <GitBranch size={14} />
                        {data.processes.find((p) => p.id === r.processId)
                          ?.name || "No technical process linked"}
                      </span>
                    </div>
                    <p className="gc-muted">
                      <strong>Mitigation:</strong>{" "}
                      {r.mitigation || "Not recorded"}
                    </p>
                    <div className="gc-linked-lessons">
                      {r.lessonIds.map((id) => {
                        const l = data.lessons.find((x) => x.id === id);
                        return l ? (
                          <div key={id}>
                            <CheckCircle2 size={15} />
                            {l.title}
                          </div>
                        ) : null;
                      })}
                    </div>
                    <button
                      className="gc-secondary"
                      disabled={busy}
                      onClick={() => void recommend(r.id)}
                    >
                      <Sparkles size={15} />
                      Recommend relevant lessons
                    </button>
                    {recommendations[r.id] && (
                      <div className="gc-recommendations">
                        <small>
                          {recommendations[r.id].method} retrieval · candidate
                          relevance, not probability
                        </small>
                        {recommendations[r.id].warning && (
                          <p>{recommendations[r.id].warning}</p>
                        )}
                        {recommendations[r.id].hits.length ? (
                          recommendations[r.id].hits.map((hit) => (
                            <div key={hit.lesson.id}>
                              <strong>{hit.lesson.title}</strong>
                              <small>{hit.reason}</small>
                              <button
                                className="gc-text-button"
                                disabled={
                                  busy || r.lessonIds.includes(hit.lesson.id)
                                }
                                onClick={() =>
                                  void act(
                                    `/risks/${r.id}/link`,
                                    { lessonId: hit.lesson.id },
                                    "Lesson linked to the risk record.",
                                  )
                                }
                              >
                                {r.lessonIds.includes(hit.lesson.id)
                                  ? "Linked"
                                  : "Link lesson"}
                                <Link2 size={13} />
                              </button>
                            </div>
                          ))
                        ) : (
                          <p>
                            No relevant approved lessons were found in this
                            project.
                          </p>
                        )}
                      </div>
                    )}
                  </article>
                ))}
              </div>
              {!scoped?.risks.length && (
                <Empty
                  title="Make experience part of risk review"
                  detail="Add a project risk, select its technical process and review the relevant approved lessons."
                />
              )}
            </>
          )}
          {tab === "access" && (
            <>
              <div className="gc-info">
                <Users size={20} />
                <div>
                  <strong>Entitlement evidence and usage tracking</strong>
                  <p>
                    Asite licensing and account provisioning remain
                    administrative actions. This workspace records the evidence
                    and expected roster; it cannot grant unlimited commercial
                    licences. Adoption uses activity recorded within the last 30
                    days.
                  </p>
                </div>
              </div>
              <section className="gc-panel">
                <div className="gc-panel-head">
                  <div>
                    <h2>Asite access roster</h2>
                    <small>
                      One roster entry per person/project · activity is only as
                      complete as the imported source
                    </small>
                  </div>
                  {admin && addButton("access", "Add roster record")}
                </div>
                {scoped?.access.length ? (
                  <div className="gc-table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Expected user</th>
                          <th>Project</th>
                          <th>Entitlement</th>
                          <th>Last activity</th>
                          <th>Evidence</th>
                        </tr>
                      </thead>
                      <tbody>
                        {scoped.access.map((a) => (
                          <tr key={a.id}>
                            <td>
                              <strong>{a.name}</strong>
                              <small>{a.email}</small>
                            </td>
                            <td>{projectName(a.projectId)}</td>
                            <td>
                              <Badge value={a.licenceStatus} />
                            </td>
                            <td>{day(a.lastActiveAt)}</td>
                            <td className="gc-wrap-cell">
                              {a.sourceReference || "Evidence needed"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <Empty
                    title="No access roster yet"
                    detail="Import the expected users, entitlement references and measured activity dates."
                  />
                )}
              </section>
              {admin && (
                <section className="gc-panel gc-spaced">
                  <div className="gc-panel-head">
                    <div>
                      <h2>Governance workspace permissions</h2>
                      <small>
                        Application roles are separate from Asite licensing and
                        project permissions.
                      </small>
                    </div>
                    {addButton("membership", "Grant workspace access")}
                  </div>
                  <div className="gc-table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Member</th>
                          <th>Entity scope</th>
                          <th>Role</th>
                          <th>Project scope</th>
                          <th>Access</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.memberships.map((m) => (
                          <tr key={m.id}>
                            <td>
                              {m.name}
                              <small>{m.email}</small>
                            </td>
                            <td>
                              {m.entityId === "*"
                                ? "Workspace administration"
                                : entityName(m.entityId)}
                            </td>
                            <td>
                              <Badge
                                value="draft"
                                label={m.role.replaceAll("_", " ")}
                              />
                            </td>
                            <td>
                              {m.projectIds.includes("*")
                                ? "All projects in scope"
                                : m.projectIds.map(projectName).join(", ")}
                            </td>
                            <td>
                              {m.active === false ? (
                                <Badge value="suspended" label="Revoked" />
                              ) : (
                                <button
                                  className="gc-text-button"
                                  disabled={busy || m.email === actor?.email}
                                  onClick={() =>
                                    void act(
                                      `/memberships/${m.id}/revoke`,
                                      {},
                                      "Application membership revoked.",
                                    )
                                  }
                                >
                                  Revoke access
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {!data.memberships.length && (
                    <p className="gc-muted">
                      Local development uses a single workspace owner. Provision
                      authenticated users for shared use.
                    </p>
                  )}
                </section>
              )}
            </>
          )}
          {tab === "setup" && (
            <>
              <div className="gc-toolbar">
                <p>
                  Start with entity and project scope, then connect approved
                  data sources.
                </p>
                <div className="gc-button-row">
                  {admin && (
                    <button
                      className="gc-secondary"
                      onClick={() => open("entity")}
                    >
                      <Plus size={15} />
                      Add entity
                    </button>
                  )}
                  {admin && addButton("project", "Add project")}
                </div>
              </div>
              <div className="gc-setup-grid">
                {[
                  {
                    name: "Asite data source",
                    ready: data.readiness.asite,
                    detail:
                      "Map Asite workspace IDs to projects. The register studio supports your own UAE session connection.",
                    label: data.readiness.asite
                      ? "Mapping added"
                      : "Not connected",
                  },
                  {
                    name: "Native Asite gates & NCR issue",
                    ready: false,
                    detail:
                      "Tenant workflow configuration, approved checklists, benchmarks and authorized official-issue rules are required.",
                    label: "Tenant setup required",
                  },
                  {
                    name: "Power BI reporting",
                    ready: data.readiness.powerBi,
                    detail:
                      "Download authenticated CSV tables now. A read-only scoped reporting token supports unattended refresh.",
                    label: data.readiness.powerBi
                      ? "Service token configured"
                      : "CSV exports available",
                  },
                  {
                    name: "Monthly automation",
                    ready: data.readiness.scheduler,
                    detail:
                      "Worker endpoint and GitHub Actions workflow are implemented. Configure entity scopes, deployment URL and secrets to enable the schedule.",
                    label: data.readiness.scheduler
                      ? "Worker configured"
                      : "Schedule not enabled",
                  },
                  {
                    name: "Lessons AI & semantic retrieval",
                    ready: data.readiness.ai,
                    detail:
                      "Source excerpts work immediately. Configure approved AI and embedding models through AI Gateway for synthesis and hybrid retrieval.",
                    label: data.readiness.ai
                      ? "AI configured"
                      : "Source retrieval ready",
                  },
                  {
                    name: "Identity & project access",
                    ready: !actor?.local,
                    detail:
                      "Better Auth sessions and server-side entity/project grants protect every governance API. Provision accounts using the setup command.",
                    label: actor?.local
                      ? "Local development mode"
                      : "Authentication enabled",
                  },
                ].map((x) => (
                  <article className="gc-panel gc-setup-card" key={x.name}>
                    <div>
                      {x.ready ? (
                        <CheckCircle2 size={23} />
                      ) : (
                        <Cloud size={23} />
                      )}
                      <Badge
                        value={x.ready ? "approved" : "draft"}
                        label={x.label}
                      />
                    </div>
                    <h3>{x.name}</h3>
                    <p>{x.detail}</p>
                  </article>
                ))}
              </div>
              <section className="gc-panel gc-spaced">
                <div className="gc-panel-head">
                  <h2>Entities & projects</h2>
                  <a className="gc-text-button" href="/registers">
                    Open Asite register studio
                    <ArrowRight size={15} />
                  </a>
                </div>
                {data.entities.map((e) => (
                  <div className="gc-entity-row" key={e.id}>
                    <Building2 size={21} />
                    <div>
                      <strong>{e.name}</strong>
                      <small>
                        Owner · {e.owner} · ID {e.id}
                      </small>
                      <p>
                        {data.projects
                          .filter((p) => p.entityId === e.id)
                          .map(
                            (p) =>
                              `${p.name}${p.asiteWorkspaceId ? ` (Asite ${p.asiteWorkspaceId})` : ""}`,
                          )
                          .join(" · ") || "No projects configured"}
                      </p>
                    </div>
                    <Badge
                      value={e.entitlement}
                      label="Commercial entitlement unverified"
                    />
                  </div>
                ))}
              </section>
              <section className="gc-panel gc-spaced">
                <div className="gc-panel-head">
                  <h2>Reporting tables</h2>
                  <span>Scoped to your permitted data and current filters</span>
                </div>
                <div className="gc-export-grid">
                  {[
                    "submissions",
                    "findings",
                    "audits",
                    "lessons",
                    "risks",
                    "access",
                  ].map((table) => (
                    <a
                      className="gc-secondary"
                      key={table}
                      href={exportUrl(table)}
                    >
                      <ArrowDownToLine size={15} />
                      {table}.csv
                    </a>
                  ))}
                </div>
              </section>
            </>
          )}
          <footer className="gc-page-footer">
            <span>ECC · Information governance</span>
            <span>
              {sample ? "Fictional demonstration records · " : ""}Workspace
              checks do not certify ISO compliance.
            </span>
          </footer>
        </main>
      </div>
      {modal && (
        <div
          className="gc-modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setModal(null);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="gc-modal-title"
            className="gc-modal"
          >
            <header>
              <div>
                <span className="gc-section-kicker">WORKSPACE RECORD</span>
                <h2 id="gc-modal-title">
                  {
                    {
                      entity: "Create an entity",
                      project: "Create a project",
                      submission: editing
                        ? "Edit submission draft"
                        : "Add a submission",
                      lesson: "Capture a lesson",
                      risk: "Add a project risk",
                      access: "Add access evidence",
                      membership: "Grant workspace access",
                      rules: "Edit rule profile",
                      import: "Import source records",
                      process: "Add a technical process",
                      closure: "Record corrective-action closure",
                    }[modal]
                  }
                </h2>
              </div>
              <button
                className="gc-icon"
                aria-label="Close dialog"
                onClick={() => setModal(null)}
              >
                <X size={20} />
              </button>
            </header>
            {error && (
              <p className="gc-message gc-error" role="alert">
                {error}
              </p>
            )}
            <form
              onSubmit={saveForm}
              key={`${modal}-${editing?.id || editingRules?.id || "new"}`}
            >
              {[
                "submission",
                "lesson",
                "risk",
                "access",
                "process",
                "import",
              ].includes(modal) && (
                <ScopeSelect
                  projects={projects.length ? projects : data.projects}
                  selected={editing?.projectId || projectId || projects[0]?.id}
                />
              )}
              {modal === "entity" && (
                <>
                  <Field label="Entity name">
                    <input name="name" required placeholder="ECC entity name" />
                  </Field>
                  <Field label="Accountable owner">
                    <input name="owner" defaultValue="M. Zaher" />
                  </Field>
                </>
              )}
              {(modal === "project" || modal === "membership") && (
                <Field label="Entity">
                  <select
                    name="entityId"
                    required
                    defaultValue={entityId || data.entities[0]?.id}
                  >
                    <option value="" disabled>
                      Select an entity
                    </option>
                    {data.entities.map((e) => (
                      <option value={e.id} key={e.id}>
                        {e.name}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              {modal === "project" && (
                <>
                  <Field label="Project name">
                    <input name="name" required />
                  </Field>
                  <Field label="Project code">
                    <input name="code" />
                  </Field>
                  <Field
                    label="Asite workspace ID"
                    hint="Optional mapping only; this does not establish a live connection."
                  >
                    <input name="asiteWorkspaceId" />
                  </Field>
                </>
              )}
              {modal === "submission" && (
                <>
                  <Field label="Submission title">
                    <input
                      name="title"
                      required
                      defaultValue={editing?.title}
                    />
                  </Field>
                  <div className="gc-form-grid">
                    {[
                      { key: "documentNo", label: "Document number" },
                      { key: "revision", label: "Revision" },
                      { key: "classification", label: "Classification" },
                      { key: "discipline", label: "Discipline" },
                      {
                        key: "suitabilityCode",
                        label: "Project suitability code",
                      },
                    ].map((f) => (
                      <Field label={f.label} key={f.key}>
                        <input
                          name={f.key}
                          defaultValue={
                            (editing?.[f.key as keyof Submission] as string) ||
                            ""
                          }
                        />
                      </Field>
                    ))}
                    <Field label="Due date (Dubai)">
                      <input
                        type="date"
                        name="dueDate"
                        defaultValue={editing?.dueDate?.slice(0, 10)}
                      />
                    </Field>
                    <Field label="Source submission date (optional)">
                      <input
                        type="date"
                        name="submittedAt"
                        defaultValue={editing?.submittedAt?.slice(0, 10)}
                      />
                    </Field>
                  </div>
                  <Field label="Source register / reference">
                    <input
                      name="sourceReference"
                      defaultValue={editing?.sourceReference}
                    />
                  </Field>
                  <h3>Mandatory checklist</h3>
                  {[
                    ...new Set(data.rules.flatMap((r) => r.requiredChecklist)),
                  ].map((k) => (
                    <label className="gc-check" key={k}>
                      <input
                        type="checkbox"
                        name={k}
                        defaultChecked={editing?.checklist[k]}
                      />
                      {k.replaceAll("_", " ")}
                    </label>
                  ))}
                  <h3>Evidence references</h3>
                  {evidenceKinds.map((kind) => (
                    <div className="gc-form-grid" key={kind}>
                      <Field label={`${kind} HTTPS source link`}>
                        <input
                          type="url"
                          name={`${kind}Url`}
                          placeholder="https://your-cde/..."
                          defaultValue={
                            editing?.evidence.find(
                              (e) => e.kind === kind && !e.url.startsWith("/"),
                            )?.url
                          }
                        />
                      </Field>
                      <Field label="Evidence revision">
                        <input
                          name={`${kind}Revision`}
                          placeholder="Must match submission revision"
                          defaultValue={
                            editing?.evidence.find((e) => e.kind === kind)
                              ?.revision
                          }
                        />
                      </Field>
                    </div>
                  ))}
                  <p className="gc-muted">
                    Saving creates a draft and resets approval. A different
                    authorized reviewer must approve the current revision.
                  </p>
                </>
              )}
              {modal === "lesson" && (
                <>
                  <Field label="Lesson title">
                    <input name="title" required />
                  </Field>
                  <Field label="Problem / context">
                    <textarea name="problem" rows={3} required />
                  </Field>
                  <Field label="What was learned">
                    <textarea name="lesson" rows={3} required />
                  </Field>
                  <Field label="Recommended action">
                    <textarea name="recommendation" rows={3} required />
                  </Field>
                  <Field label="Tags (comma separated)">
                    <input
                      name="tags"
                      placeholder="coordination, revision, waterproofing"
                    />
                  </Field>
                  <Field label="CDE source link">
                    <input
                      name="sourceUrl"
                      type="url"
                      placeholder="https://your-cde/..."
                      required
                    />
                  </Field>
                  <Field label="Source revision">
                    <input name="sourceRevision" required />
                  </Field>
                </>
              )}
              {modal === "risk" && (
                <>
                  <Field label="Risk title">
                    <input name="title" required />
                  </Field>
                  <Field label="Cause, event and consequence">
                    <textarea name="description" required rows={3} />
                  </Field>
                  <Field label="Accountable owner">
                    <input name="owner" defaultValue={actor?.name} />
                  </Field>
                  <div className="gc-form-grid">
                    {["likelihood", "impact"].map((k) => (
                      <Field key={k} label={k}>
                        <select name={k} defaultValue="3">
                          {[1, 2, 3, 4, 5].map((v) => (
                            <option key={v}>{v}</option>
                          ))}
                        </select>
                      </Field>
                    ))}
                  </div>
                  <Field label="Technical process">
                    <select name="processId">
                      <option value="">No process selected</option>
                      {data.processes.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} · {projectName(p.projectId)}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Current mitigation">
                    <textarea name="mitigation" rows={2} />
                  </Field>
                </>
              )}
              {modal === "process" && (
                <>
                  <Field label="Process name">
                    <input name="name" required />
                  </Field>
                  <Field label="Process description">
                    <textarea name="description" rows={3} />
                  </Field>
                </>
              )}
              {(modal === "access" || modal === "membership") && (
                <>
                  <Field label="Person’s name">
                    <input name="name" required />
                  </Field>
                  <Field label="Email">
                    <input name="email" type="email" required />
                  </Field>
                </>
              )}
              {modal === "access" && (
                <>
                  <Field label="Entitlement status">
                    <select name="licenceStatus">
                      <option value="unverified">Unverified</option>
                      <option value="confirmed">Confirmed by evidence</option>
                      <option value="suspended">Suspended</option>
                    </select>
                  </Field>
                  <Field label="Last measured activity">
                    <input name="lastActiveAt" type="date" />
                  </Field>
                  <Field label="Licence / activity evidence reference">
                    <textarea name="sourceReference" rows={2} />
                  </Field>
                </>
              )}
              {modal === "membership" && (
                <>
                  <Field label="Application role">
                    <select name="role">
                      {[
                        "viewer",
                        "contributor",
                        "reviewer",
                        "qa_manager",
                        "admin",
                      ].map((r) => (
                        <option key={r} value={r}>
                          {r.replaceAll("_", " ")}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field
                    label="Allowed project IDs"
                    hint="Comma-separated IDs, or * for every project in the chosen entity."
                  >
                    <input name="projectIds" defaultValue="*" required />
                  </Field>
                  <p className="gc-muted">
                    The account must be provisioned using the setup command.
                    This grants application permissions; it does not provision
                    Asite access.
                  </p>
                </>
              )}
              {modal === "rules" && editingRules && (
                <>
                  <Field label="Profile name">
                    <input
                      name="name"
                      defaultValue={editingRules.name}
                      required
                    />
                  </Field>
                  <Field
                    label="New version"
                    hint="Changes to an approved profile must use a different version."
                  >
                    <input
                      name="version"
                      defaultValue={
                        editingRules.status === "approved"
                          ? `${editingRules.version}-next`
                          : editingRules.version
                      }
                      required
                    />
                  </Field>
                  {[
                    {
                      key: "requiredMetadata",
                      label: "Required metadata fields",
                    },
                    {
                      key: "requiredChecklist",
                      label: "Mandatory checklist keys",
                    },
                    {
                      key: "requiredEvidence",
                      label: "Required evidence kinds",
                    },
                    {
                      key: "allowedSuitability",
                      label: "Allowed project suitability codes (optional)",
                    },
                  ].map((f) => (
                    <Field
                      key={f.key}
                      label={f.label}
                      hint="Comma-separated values"
                    >
                      <input
                        name={f.key}
                        defaultValue={(
                          editingRules[f.key as keyof RuleProfile] as string[]
                        ).join(", ")}
                      />
                    </Field>
                  ))}
                  <Field label="Observation response days (calendar)">
                    <input
                      name="responseDays"
                      type="number"
                      min={1}
                      max={90}
                      defaultValue={editingRules.responseDays}
                      required
                    />
                  </Field>
                  <Field
                    label="Approved monthly adoption target (%)"
                    hint="Optional. A finding is generated only when complete period activity history is supplied."
                  >
                    <input
                      name="minimumAdoptionPercent"
                      type="number"
                      min={0}
                      max={100}
                      defaultValue={editingRules.minimumAdoptionPercent ?? ""}
                    />
                  </Field>
                  <Field label="Approved project procedure/reference">
                    <textarea
                      name="approvalReference"
                      rows={2}
                      defaultValue={editingRules.approvalReference}
                    />
                  </Field>
                  <p className="gc-muted">
                    The profile is saved as a draft. A quality manager must
                    approve it before enforcement.
                  </p>
                </>
              )}
              {modal === "import" && (
                <>
                  <Field label="Record type">
                    <select
                      value={importKind}
                      onChange={(e) => setImportKind(e.target.value)}
                    >
                      <option value="submissions">
                        Submission / checklist records
                      </option>
                      <option value="lessons">Source-linked lessons</option>
                      <option value="access">
                        Expected-user / entitlement roster
                      </option>
                    </select>
                  </Field>
                  <Field label="Choose a JSON file">
                    <input
                      type="file"
                      accept=".json,application/json"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          if (file.size > 1_900_000) {
                            setError("Use a JSON file smaller than 1.9 MB.");
                            return;
                          }
                          setImportText(await file.text());
                        }
                      }}
                    />
                  </Field>
                  <Field label="Or paste normalized JSON">
                    <textarea
                      rows={9}
                      value={importText}
                      onChange={(e) => setImportText(e.target.value)}
                      placeholder="[{...}]"
                    />
                  </Field>
                  <button
                    type="button"
                    className="gc-text-button"
                    onClick={() =>
                      downloadJson(
                        importTemplate(importKind),
                        `ECC-${importKind}-template.json`,
                      )
                    }
                  >
                    <ArrowDownToLine size={14} />
                    Download format template
                  </button>
                  <p className="gc-muted">
                    All rows must pass validation before any are stored.
                    Imported approvals are not inferred; submissions require an
                    independent workspace review.
                  </p>
                </>
              )}
              {modal === "closure" && (
                <Field label="Corrective action and effectiveness evidence">
                  <textarea
                    name="closureEvidence"
                    rows={5}
                    placeholder="Reference the action taken and the evidence that verifies it worked."
                    required
                  />
                </Field>
              )}
              <footer>
                <button
                  type="button"
                  className="gc-secondary"
                  onClick={() => setModal(null)}
                >
                  Cancel
                </button>
                <button
                  className="gc-primary"
                  disabled={
                    busy ||
                    (!data.projects.length &&
                      [
                        "submission",
                        "lesson",
                        "risk",
                        "access",
                        "process",
                        "import",
                      ].includes(modal))
                  }
                >
                  {busy && <Loader2 size={15} className="gc-spin" />}
                  {modal === "import" ? "Validate & import" : "Save record"}
                </button>
              </footer>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}

function ScopeSelect({
  projects,
  selected,
}: {
  projects: WorkspaceSnapshot["projects"];
  selected?: string;
}) {
  return (
    <Field label="Project">
      <select
        name="projectId"
        defaultValue={selected || projects[0]?.id}
        required
      >
        <option value="" disabled>
          Choose a project
        </option>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </Field>
  );
}

function GateDetail({
  submission: s,
  result,
  project,
  busy,
  actorId,
  canReview,
  onEdit,
  onReview,
  onSubmit,
}: {
  submission: Submission;
  result: GateResult;
  project: string;
  busy: boolean;
  actorId: string;
  canReview: boolean;
  onEdit: () => void;
  onReview: () => void;
  onSubmit: () => void;
}) {
  return (
    <>
      <div className="gc-panel-head">
        <div>
          <span className="gc-section-kicker">{project}</span>
          <h2>{s.documentNo || s.title}</h2>
          <p>{s.title}</p>
        </div>
        <Badge
          value={result.passed ? "approved" : "draft"}
          label={
            result.passed ? "Ready for local submission" : "Action required"
          }
        />
      </div>
      <div className="gc-gate-summary">
        <span>
          Revision <strong>{s.revision || "Missing"}</strong>
        </span>
        <span>
          Owner <strong>{s.owner}</strong>
        </span>
        <span>
          Rule profile <strong>v{result.ruleVersion}</strong>
        </span>
        <span>
          Due <strong>{day(s.dueDate)}</strong>
        </span>
      </div>
      {!result.rulesApproved && (
        <p className="gc-message gc-error">
          Approve the project rule profile before using this gate.
        </p>
      )}
      <div className="gc-checklist">
        {result.issues.length ? (
          result.issues.map((i) => (
            <div key={i.code}>
              <span className="gc-check-failed">
                <X size={15} />
              </span>
              <div>
                <strong>{i.requirement}</strong>
                <p>{i.actual}</p>
              </div>
              <Badge value={i.severity} label={i.severity} />
            </div>
          ))
        ) : (
          <div>
            <span className="gc-check-passed">
              <Check size={16} />
            </span>
            <div>
              <strong>All configured checks passed</strong>
              <p>
                Metadata, checklist, revision-linked evidence and independent
                approval are present.
              </p>
            </div>
          </div>
        )}
      </div>
      <h3>Evidence references</h3>
      {s.evidence.length ? (
        s.evidence.map((e) => (
          <a
            key={e.id}
            className="gc-evidence"
            href={e.url}
            target="_blank"
            rel="noreferrer"
          >
            <FileText size={17} />
            <span>
              {e.title}
              <small>
                {e.kind} · revision {e.revision}
              </small>
            </span>
            <Link2 size={14} />
          </a>
        ))
      ) : (
        <p className="gc-muted">No supporting evidence is attached.</p>
      )}
      <div className="gc-reviewer">
        <Users size={17} />
        {s.reviewerName
          ? `${s.reviewerName} approved revision ${s.reviewedRevision}`
          : "Independent reviewer approval is needed."}
      </div>
      <footer className="gc-card-footer">
        <button className="gc-secondary" onClick={onEdit}>
          Edit draft
        </button>
        <div>
          <button
            className="gc-secondary"
            disabled={busy || !canReview || s.ownerId === actorId}
            onClick={onReview}
          >
            Record reviewer approval
          </button>
          <button
            className="gc-primary"
            disabled={busy || !result.passed || s.status === "submitted"}
            onClick={onSubmit}
          >
            {s.status === "submitted"
              ? "Submitted locally"
              : "Submit through gate"}
            <ArrowRight size={15} />
          </button>
        </div>
      </footer>
    </>
  );
}
function importTemplate(kind: string) {
  if (kind === "lessons")
    return [
      {
        title: "Replace with an actual case",
        problem: "Observed project context",
        lesson: "Evidence-supported learning",
        recommendation: "Specific recommended action",
        tags: ["coordination"],
        sourceUrl: "https://your-cde.example/document",
        sourceRevision: "P01",
      },
    ];
  if (kind === "access")
    return [
      {
        name: "Person name",
        email: "person@example.com",
        licenceStatus: "unverified",
        lastActiveAt: "",
        sourceReference: "",
      },
    ];
  return [
    {
      title: "Submission title",
      documentNo: "PROJECT-DOC-001",
      revision: "P01",
      classification: "Project-defined class",
      discipline: "Project-defined discipline",
      suitabilityCode: "Project-defined suitability",
      dueDate: "2026-10-30",
      submittedAt: "2026-10-01",
      checklist: {
        design_check: false,
        benchmark_check: false,
        coordination_check: false,
      },
      evidence: [],
      sourceReference: "Approved export / document reference",
    },
  ];
}
