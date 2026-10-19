"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties } from "react";
import { ArrowDownToLine, ArrowRight, ArrowUpRight, Building2, Check, CheckCheck, ChevronDown, ChevronRight, CircleHelp, ClipboardList, Cloud, Database, FileCheck2, FileSpreadsheet, FileText, FolderClosed, FolderSearch, LayoutDashboard, Link2, ListFilter, Loader2, LockKeyhole, LogOut, MoreHorizontal, RefreshCw, Search, ShieldCheck, SlidersHorizontal, Sparkles, TriangleAlert, Upload, UserRound, X } from "lucide-react";
import { HEADERS, buildDashboard, summarize, generateDemoRecords, classifyStatus, retainedRecords, type RegisterRecord } from "@/lib/dashboard";
import { parseRegister } from "@/lib/register-parser";
import { exportDashboard } from "@/lib/excel-export";
import { isE1FolderName, isExplicitNonShopFile, projectDisplayCode } from "@/lib/folder-rules";
import type { Project, Folder, AsiteFile } from "@/lib/asite-types";

type Tab = "overview" | "ledger" | "connection";
type SourceKind = "none" | "asite" | "upload" | "demo";
type SourceSummary = { kind: SourceKind; label: string; files: number; updatedAt?: string };
type Filters = { project: string; discipline: string; dashboardRow: string; package: string; search: string };
const EMPTY_FILTERS: Filters = { project: "", discipline: "", dashboardRow: "", package: "", search: "" };
const INITIAL_SOURCE: SourceSummary = { kind: "none", label: "No source connected", files: 0 };

async function api<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { method: body === undefined ? "GET" : "POST", headers: body === undefined ? undefined : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), signal, cache: "no-store" });
  const result = await response.json().catch(() => ({ error: "The server returned an unreadable response. Try again." }));
  if (!response.ok) {
    const diagnostic = result.diagnostic;
    const structure = diagnostic?.dataKeys && Object.keys(diagnostic.dataKeys).length ? diagnostic.dataKeys : diagnostic?.rootKeys;
    const allowed = new Set(["asiteDataList", "UserProfile", "AsiteAPIExceptionThrown", "workspaceVO", "folderVO", "documentVO", "URI", "errorCode", "errorMessage", "errorDescription", "ERROR_MESSAGE", "ERROR_DESCRIPTION", "Sessionid"]);
    const fields = structure && typeof structure === "object" ? Object.entries(structure).filter(([key, type]) => allowed.has(key) && ["object", "array", "null", "string", "number", "boolean", "ambiguous"].includes(String(type))).map(([key, type]) => `${key}: ${type}`).join(", ") : "";
    const operation = ["login", "projects", "folders", "documents", "download", "api"].includes(diagnostic?.operation) ? diagnostic.operation : "api";
    const format = ["xml", "json", "html", "text"].includes(diagnostic?.format) ? diagnostic.format.toUpperCase() : "response";
    const status = Number.isInteger(diagnostic?.httpStatus) ? `HTTP ${diagnostic.httpStatus}` : "";
    const envelope = diagnostic?.envelopeState === "empty" ? "empty data envelope" : diagnostic?.envelopeState === "text" ? "nonempty text envelope" : "";
    const details = diagnostic ? ` [${[operation, format, status, fields, envelope].filter(Boolean).join(" · ")}]` : "";
    throw new Error((typeof result.error === "string" ? result.error : `Request failed (${response.status}).`) + details);
  }
  return result as T;
}

function preferredProjects(projects: Project[]): string[] {
  const specified = projects.filter(project => projectDisplayCode(project.name));
  return (specified.length ? specified : projects).map(project => project.id);
}

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : "Something went wrong. Please try again."; }
function unique(records: RegisterRecord[], field: keyof RegisterRecord): string[] { return [...new Set(records.map(record => String(record[field] ?? "")).filter(Boolean))].sort((a, b) => a.localeCompare(b)); }
function classify(status: string): "approved" | "rejected" | "other" { const outcome = classifyStatus(status); return outcome === "approved" || outcome === "rejected" ? outcome : "other"; }
function displayCell(value: string | number, column: number): string {
  if (typeof value === "string") return value;
  if ([19, 20, 21, 22, 23, 24, 26, 27].includes(column)) return `${(value * 100).toFixed(1)}%`;
  if (column === 25) return value.toFixed(2);
  return value.toLocaleString();
}
function e1Folders(folders: Folder[]): Folder[] {
  const ids = new Set(folders.filter(folder => folder.isE1 || isE1FolderName(folder.name)).map(folder => folder.id));
  let changed = true;
  while (changed) { changed = false; for (const folder of folders) if (folder.parentId && ids.has(folder.parentId) && !ids.has(folder.id)) { ids.add(folder.id); changed = true; } }
  return folders.filter(folder => ids.has(folder.id));
}

export default function Home() {
  const [tab, setTab] = useState<Tab>("overview");
  const [records, setRecords] = useState<RegisterRecord[]>([]);
  const [source, setSource] = useState<SourceSummary>(INITIAL_SOURCE);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [connected, setConnected] = useState(false);
  const [oauth, setOauth] = useState(false);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [sessionId, setSessionId] = useState("");
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjects, setSelectedProjects] = useState<string[]>([]);
  const [modal, setModal] = useState<"connect" | "source" | "export" | "help" | null>(null);
  const [connectMode, setConnectMode] = useState<"session" | "token">("session");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [tokenInput, setTokenInput] = useState("");
  const [connectionBusy, setConnectionBusy] = useState(false);
  const [autoExtractPending, setAutoExtractPending] = useState(false);
  const [connectionError, setConnectionError] = useState("");
  const [sourceMode, setSourceMode] = useState<"asite" | "upload">("asite");
  const [uploadProject, setUploadProject] = useState("");
  const [uploadPackage, setUploadPackage] = useState("");
  const [folders, setFolders] = useState<Folder[]>([]);
  const [folderBusy, setFolderBusy] = useState(false);
  const [scanBusy, setScanBusy] = useState(false);
  const [scanProgress, setScanProgress] = useState("");
  const [scanCount, setScanCount] = useState(0);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [warningsExpanded, setWarningsExpanded] = useState(false);
  const [error, setError] = useState("");
  const [incomplete, setIncomplete] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState("");
  const [ledgerPage, setLedgerPage] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const generationRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    let active = true;
    const query = new URLSearchParams(window.location.search);
    const callbackError = query.get("connectionError");
    if (callbackError) { setConnectionError(callbackError); setModal("connect"); }
    if (query.has("connectionError") || query.has("connected")) window.history.replaceState({}, "", window.location.pathname);
    api<{ configured: boolean; connected: boolean; projects?: Project[]; error?: string }>("/api/asite/session").then(async result => {
      if (!active) return;
      setConfigured(result.configured);
      if (result.connected) {
        setConnected(true); setOauth(true);
        const available = result.projects ?? (await api<{ projects: Project[] }>("/api/asite/projects", { region: "uae", sessionId: "", authType: "oauth" })).projects;
        if (active) { setProjects(available); setSelectedProjects(available.length ? [available[0].id] : []); }
      }
      if (result.error && active) setConnectionError(result.error);
    }).catch(cause => { if (active) { setConfigured(false); if (query.has("connected")) { setConnectionError(errorMessage(cause)); setModal("connect"); } } });
    return () => { active = false; abortRef.current?.abort(); };
  }, []);

  useEffect(() => {
    if (autoExtractPending && connected && !connectionBusy && !scanBusy) {
      setAutoExtractPending(false);
      void scanAsite();
    }
  }, [autoExtractPending, connected, connectionBusy, scanBusy]);

  useEffect(() => { setLedgerPage(0); }, [filters, records]);
  useEffect(() => {
    if (!modal) return;
    previousFocusRef.current = document.activeElement as HTMLElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusTimer = window.setTimeout(() => modalRef.current?.querySelector<HTMLElement>("button, input, select, a[href]")?.focus(), 0);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !connectionBusy && !scanBusy) setModal(null);
      if (event.key === "Tab") {
        const focusable = Array.from(modalRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href]") ?? []);
        const first = focusable[0]; const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => { window.clearTimeout(focusTimer); document.removeEventListener("keydown", onKey); document.body.style.overflow = previousOverflow; previousFocusRef.current?.focus(); };
  }, [modal, connectionBusy, scanBusy]);

  const filtered = useMemo(() => retainedRecords(records).filter(record => (!filters.project || record.project === filters.project) && (!filters.discipline || record.discipline === filters.discipline) && (!filters.dashboardRow || record.dashboardRow === filters.dashboardRow) && (!filters.package || record.package === filters.package) && (!filters.search || `${record.scope} ${record.documentNo} ${record.sourceFile}`.toLowerCase().includes(filters.search.toLowerCase()))), [records, filters]);
  const summary = useMemo(() => summarize(filtered), [filtered]);
  const rows = useMemo(() => buildDashboard(filtered), [filtered]);
  const revisions = useMemo(() => {
    const result = Array.from({ length: Math.max(6, Math.min(12, (summary.maxRevision ?? 0) + 1)) }, (_, revision) => ({ revision, approved: 0, rejected: 0 }));
    for (const record of filtered) if (record.revision !== null && record.revision >= 0 && record.revision < result.length) { const status = classify(record.status); if (status === "approved") result[record.revision].approved++; else if (status === "rejected") result[record.revision].rejected++; }
    return result;
  }, [filtered, summary.maxRevision]);
  const revisionMax = Math.max(1, ...revisions.flatMap(revision => [revision.approved, revision.rejected]));
  const approvalShare = summary.recordCount ? Math.round(summary.approvals / summary.recordCount * 100) : 0;
  const filtersActive = Object.values(filters).some(Boolean);
  const hasSource = source.kind !== "none";
  const ledgerRecords = filtered.slice(ledgerPage * 50, ledgerPage * 50 + 50);

  function updateFilter(field: keyof Filters, value: string) { setFilters(current => ({ ...current, [field]: value })); }
  function openSource() { setSourceMode(connected ? "asite" : "upload"); setModal("source"); setError(""); }
  async function connectSession() {
    if (!email.trim() || !password) { setConnectionError("Enter your Asite email and password."); return; }
    setConnectionBusy(true); setConnectionError("");
    try {
      const result = await api<{ sessionId: string; projects: Project[] }>("/api/asite/login", { region: "uae", email: email.trim(), password });
      setSessionId(result.sessionId); setConnected(true); setOauth(false); setProjects(result.projects); setSelectedProjects(preferredProjects(result.projects)); setRecords([]); setSource(INITIAL_SOURCE); setModal(null); setSourceMode("asite"); setAutoExtractPending(true);
    } catch (cause) { setConnectionError(errorMessage(cause)); }
    finally { setPassword(""); setConnectionBusy(false); }
  }
  async function connectToken() {
    if (!tokenInput.trim()) { setConnectionError("Enter your existing Asite host-session key."); return; }
    setConnectionBusy(true); setConnectionError("");
    try {
      const result = await api<{ projects: Project[] }>("/api/asite/projects", { region: "uae", sessionId: tokenInput.trim(), authType: "session" });
      setSessionId(tokenInput.trim()); setTokenInput(""); setConnected(true); setOauth(false); setProjects(result.projects); setSelectedProjects(preferredProjects(result.projects)); setRecords([]); setSource(INITIAL_SOURCE); setModal(null); setSourceMode("asite"); setAutoExtractPending(true);
    } catch (cause) { setConnectionError(errorMessage(cause)); }
    finally { setConnectionBusy(false); }
  }
  async function disconnect() {
    generationRef.current++; abortRef.current?.abort();
    setConnected(false); setAutoExtractPending(false); setOauth(false); setSessionId(""); setTokenInput(""); setEmail(""); setPassword(""); setProjects([]); setSelectedProjects([]); setFolders([]); setRecords([]); setSource(INITIAL_SOURCE); setFilters(EMPTY_FILTERS); setWarnings([]); setError(""); setConnectionError(""); setIncomplete(false); setScanBusy(false); setModal(null);
    try { await api("/api/asite/logout", {}); } catch (cause) { setError(`Local session cleared. Server sign-out could not be confirmed: ${errorMessage(cause)}`); }
  }
  async function previewFolders(projectId: string) {
    setFolders([]); setFolderBusy(true); setError("");
    try { const result = await api<{ folders: Folder[] }>("/api/asite/folders", { region: "uae", sessionId, authType: oauth ? "oauth" : "session", projectId }); setFolders(e1Folders(result.folders)); }
    catch (cause) { setError(errorMessage(cause)); }
    finally { setFolderBusy(false); }
  }
  async function scanAsite() {
    if (!selectedProjects.length || !connected || scanBusy) return;
    const controller = new AbortController(); abortRef.current = controller;
    const generation = ++generationRef.current;
    const collected: RegisterRecord[] = []; const scanWarnings: string[] = [];
    let fileCount = 0; let partial = false;
    setScanBusy(true); setScanCount(0); setError(""); setWarnings([]); setModal(null); setFilters(EMPTY_FILTERS);
    for (const projectId of selectedProjects) {
      if (controller.signal.aborted) { partial = true; break; }
      const project = projects.find(item => item.id === projectId);
      if (!project) continue;
      try {
        setScanProgress(`Finding E1 folders · ${project.name}`);
        const tree = await api<{ folders: Folder[] }>("/api/asite/folders", { region: "uae", sessionId, authType: oauth ? "oauth" : "session", projectId }, controller.signal);
        const e1 = e1Folders(tree.folders); setFolders(e1);
        if (!e1.length) { scanWarnings.push(`${project.name}: no E1 folder found. This project was not included.`); partial = true; continue; }
        const seenFiles = new Set<string>();
        for (const folder of e1) {
          if (controller.signal.aborted) { partial = true; break; }
          let cursor: string | undefined; const visited = new Set<string>();
          try {
            do {
              setScanProgress(`Reading E1 folder · ${project.name} / ${folder.name}`);
              const page: { files: AsiteFile[]; nextCursor?: string } = await api("/api/asite/files", { region: "uae", sessionId, authType: oauth ? "oauth" : "session", projectId, folderIds: [folder.id], cursor }, controller.signal);
              for (const file of page.files) {
                if (controller.signal.aborted) { partial = true; break; }
                if (seenFiles.has(file.id)) continue; seenFiles.add(file.id);
                if (isExplicitNonShopFile(file.name)) { scanWarnings.push(`${project.name} / ${file.name}: excluded because it is marked E2 or material submittals, outside the shop drawing scope.`); continue; }
                if (!/\.xlsx$/i.test(file.name)) { scanWarnings.push(`${project.name} / ${file.name}: only .xlsx shop drawing registers are supported; this file was skipped.`); if (/\.xls$/i.test(file.name)) partial = true; continue; }
                if (!file.downloadable) { scanWarnings.push(`${project.name} / ${file.name}: no accessible download was provided.`); partial = true; continue; }
                setScanProgress(`Extracting revision history · ${project.name} / ${folder.name} / ${file.name}`);
                try {
                  const result = await api<{ records: RegisterRecord[]; warnings: string[] }>("/api/asite/register", { region: "uae", sessionId, authType: oauth ? "oauth" : "session", projectId, file }, controller.signal);
                  collected.push(...result.records); fileCount++; setScanCount(collected.length);
                  scanWarnings.push(...result.warnings.map(warning => `${file.name}: ${warning}`));
                  if (!result.records.length) partial = true;
                } catch (cause) {
                  if (controller.signal.aborted) { partial = true; break; }
                  scanWarnings.push(`${project.name} / ${folder.name} / ${file.name}: ${errorMessage(cause)}`); partial = true;
                }
              }
              if (controller.signal.aborted) { partial = true; break; }
              cursor = page.nextCursor;
              if (cursor && visited.has(cursor)) { scanWarnings.push(`${project.name} / ${folder.name}: the file listing repeated a page token. Extraction stopped for this folder to avoid duplicate totals.`); partial = true; break; }
              if (cursor) visited.add(cursor);
            } while (cursor);
          } catch (cause) {
            partial = true;
            if (!controller.signal.aborted) scanWarnings.push(`${project.name} / ${folder.name}: ${errorMessage(cause)}`);
          }
        }
      } catch (cause) {
        partial = true;
        if (!controller.signal.aborted) scanWarnings.push(`${project.name}: ${errorMessage(cause)}`);
      }
    }
    if (generation !== generationRef.current) return;
    if (controller.signal.aborted) scanWarnings.unshift("Extraction was cancelled. Only registers read before cancellation are included.");
    if (!collected.length) scanWarnings.push("No revision records were extracted. Check the E1 folder and that the files contain a drawing register, rather than a dashboard template.");
    setRecords(collected); setSource({ kind: "asite", label: `${selectedProjects.length} project${selectedProjects.length === 1 ? "" : "s"} · E1 schedules`, files: fileCount, updatedAt: new Date().toISOString() }); setWarnings(scanWarnings); setIncomplete(partial || !collected.length); setScanBusy(false); setScanProgress(""); setTab("overview");
  }
  async function uploadFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []); event.target.value = "";
    if (!files.length || scanBusy) return;
    const collected: RegisterRecord[] = []; const uploadWarnings: string[] = [];
    let accepted = 0; let partial = false;
    setScanBusy(true); setScanCount(0); setWarnings([]); setError(""); setModal(null); setFilters(EMPTY_FILTERS);
    for (const file of files) {
      if (isExplicitNonShopFile(file.name)) { uploadWarnings.push(`${file.name}: excluded because it is marked E2 or material submittals, outside the shop drawing scope.`); continue; }
      if (!/\.xlsx$/i.test(file.name)) { uploadWarnings.push(`${file.name}: please use an .xlsx shop drawing register.`); partial = true; continue; }
      setScanProgress(`Reading local register · ${file.name}`);
      try {
        const result = await parseRegister(await file.arrayBuffer(), { sourceFile: file.name, project: uploadProject.trim() || "Uploaded project", package: uploadPackage.trim() || undefined });
        collected.push(...result.records); uploadWarnings.push(...result.warnings.map(warning => `${file.name}: ${warning}`)); accepted++; setScanCount(collected.length); if (!result.records.length) partial = true;
      } catch (cause) { uploadWarnings.push(`${file.name}: ${errorMessage(cause)}`); partial = true; }
    }
    if (!collected.length) uploadWarnings.push("No drawing revision records were found. The dashboard template is an export layout; upload the underlying E1 shop drawing register as your source.");
    setRecords(collected); setSource({ kind: "upload", label: files.length === 1 ? files[0].name : `${files.length} uploaded registers`, files: accepted, updatedAt: new Date().toISOString() }); setWarnings(uploadWarnings); setIncomplete(partial || !collected.length); setScanBusy(false); setScanProgress(""); setTab("overview");
  }
  function exploreDemo() {
    setRecords(generateDemoRecords()); setSource({ kind: "demo", label: "Example drawing registers", files: 0 }); setFilters(EMPTY_FILTERS); setWarnings([]); setIncomplete(false); setError(""); setTab("overview"); setModal(null);
  }
  async function downloadExport(acknowledged = false) {
    if (!filtered.length) return;
    if ((incomplete || warnings.length || source.kind === "demo") && !acknowledged) { setExportError(""); setModal("export"); return; }
    setExportBusy(true); setExportError("");
    try {
      const bytes = await exportDashboard(filtered, { title: "E1 Drawing Approval Dashboard", source: `${source.kind === "demo" ? "SYNTHETIC DEMO · " : ""}${source.label}${incomplete ? " · INCOMPLETE EXTRACTION" : ""}${filtersActive ? " · filtered view" : ""}${warnings.length ? ` · ${warnings.length} extraction warning(s)` : ""}`, warnings });
      const objectUrl = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      const link = document.createElement("a"); link.href = objectUrl; link.download = `E1-dashboard${source.kind === "demo" ? "-DEMO" : ""}${incomplete ? "-PARTIAL" : ""}-${new Date().toISOString().slice(0, 10)}.xlsx`; document.body.append(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000); setModal(null);
    } catch (cause) { const message = errorMessage(cause); setExportError(message); if (modal !== "export") setError(`Export failed: ${message}`); }
    finally { setExportBusy(false); }
  }

  const navItems = [{ key: "overview" as Tab, label: "Overview", Icon: LayoutDashboard }, { key: "ledger" as Tab, label: "Revision ledger", Icon: ClipboardList }, { key: "connection" as Tab, label: "Connection", Icon: Link2 }];
  const navigation = (mobile = false) => <nav className={mobile ? "mobile-menu" : "side-nav"} aria-label={mobile ? "Mobile workspace navigation" : "Workspace navigation"}>{navItems.map(({ key, label, Icon }) => <button key={key} className={`nav-item ${tab === key ? "active" : ""}`} onClick={() => setTab(key)} aria-current={tab === key ? "page" : undefined}><Icon size={16} strokeWidth={1.6} /><span>{label}</span></button>)}</nav>;

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-symbol">E1</div><div className="brand-name">e1<span> studio</span></div></div>
      <div className="workspace-name">Your workspace</div>
      <div className="workspace-selector"><div className="workspace-avatar"><Building2 size={15} /></div><div className="workspace-label">Drawing operations<small>Asite · UAE Cloud</small></div><ChevronDown size={12} color="#99a59b" /></div>
      {navigation()}
      <div className="nav-divider" />
      <button className="nav-item" onClick={() => setModal("help")}><CircleHelp size={16} strokeWidth={1.6} /><span>How it works</span></button>
      <div className="sidebar-note"><ShieldCheck size={19} strokeWidth={1.5} />Your E1 schedules.<br />One clear picture.</div>
      <div className="sidebar-footer"><div className="user-avatar"><UserRound size={15} strokeWidth={1.5} /></div><div><strong>{connected ? "Asite connected" : "Your session"}</strong><small>{connected ? "UAE Cloud workspace" : "Ready when you are"}</small></div><span className={`connection-dot ${connected ? "connected" : ""}`} /></div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><div className="breadcrumb">Workspace<ChevronRight size={11} /><strong>{tab === "overview" ? "Overview" : tab === "ledger" ? "Revision ledger" : "Connection"}</strong></div><div className="topbar-right"><div className={`environment-label ${connected ? "live" : ""}`}><span />{connected ? "Asite connected" : source.kind === "demo" ? "Demo workspace" : "Local workspace"}</div><button className="icon-button round" aria-label="Open help" onClick={() => setModal("help")}><CircleHelp size={15} strokeWidth={1.6} /></button></div></header>
      {navigation(true)}
      <main className="main-content">
        <div className="page-heading"><div><div className="eyebrow">Drawing operations</div><div className="title-row"><h1>{tab === "overview" ? "Drawing intelligence" : tab === "ledger" ? "Revision ledger" : "Your Asite connection"}</h1><span className="badge teal"><FolderClosed size={10} />E1 · Schedules</span>{source.kind === "demo" && <span className="badge demo">Demo data</span>}</div><p>{tab === "overview" ? "From drawing submissions to approvals. Every revision, in view." : tab === "ledger" ? "Trace every submission back to its source register." : "One connection. Your schedules, folders, and drawing history."}</p></div><div className="heading-actions"><button className="button" onClick={openSource} disabled={scanBusy}><RefreshCw size={13} />{hasSource ? "Update source" : "Add source"}</button><button className="button primary" onClick={() => downloadExport()} disabled={!filtered.length || scanBusy || exportBusy}>{exportBusy ? <Loader2 size={13} className="spin" /> : <ArrowDownToLine size={13} />}Export Excel</button></div></div>

        {error && <div className="notice error" role="alert"><TriangleAlert size={15} /><div className="notice-content">{error}</div><button className="icon-button" aria-label="Dismiss error" onClick={() => setError("")}><X size={14} /></button></div>}
        {warnings.length > 0 && <div className="notice" role="status"><TriangleAlert size={15} /><div className="notice-content"><strong>{incomplete ? "Extraction needs review" : "Source notes"} · {warnings.length} {warnings.length === 1 ? "warning" : "warnings"}</strong><p>{incomplete ? "Some source data could not be read. These totals may be incomplete." : "Review the source notes before using or sharing these totals."} <button className="warning-link" onClick={() => setWarningsExpanded(!warningsExpanded)}>{warningsExpanded ? "Hide details" : "View details"}</button></p>{warningsExpanded && <ul className="notice-list">{warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}</div></div>}
        {scanBusy && <div className="panel progress-panel" role="status" aria-live="polite"><div className="progress-label"><span><Loader2 size={14} className="spin" />{scanProgress || "Preparing extraction…"}</span>{sourceMode === "asite" && <button className="button text small" onClick={() => abortRef.current?.abort()}><X size={11} />Cancel</button>}</div><div className="progress-track"><div /></div><div className="progress-subtext">{scanCount.toLocaleString()} revision records read · Every source warning will remain visible.</div></div>}

        {tab !== "connection" && <>
          <section className="hero-panel" aria-label="Drawing source"><div className="hero-content"><div className="hero-icon">{hasSource ? <FileCheck2 size={27} strokeWidth={1.25} /> : <FolderSearch size={27} strokeWidth={1.25} />}</div><div className="hero-text"><h2>{hasSource ? source.kind === "demo" ? "A preview of your drawing workspace" : "Your schedules, brought together" : "A clearer view starts with your schedules"}</h2><p>{hasSource ? source.kind === "demo" ? "Explore a synthetic example. Connect Asite or upload your register to see your own project." : `${source.label} · ${source.files} ${source.files === 1 ? "register" : "registers"} · ${records.length.toLocaleString()} revision records` : "Connect your Asite UAE account to read E1 schedules, or upload a shop drawing register. We’ll take care of the revision dashboard."}</p>{hasSource && <div className="source-status">{incomplete ? <TriangleAlert size={10} /> : <CheckCheck size={11} />}{source.kind === "demo" ? "Synthetic sample · no live Asite data" : incomplete ? "Incomplete extraction · review source warnings" : source.updatedAt ? `Last extracted ${new Date(source.updatedAt).toLocaleString("en-GB", { timeZone: "Asia/Dubai", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} GST` : "Source ready"}</div>}</div></div><div className="hero-actions"><button className="button primary" onClick={() => connected ? openSource() : setModal("connect")} disabled={scanBusy}><Link2 size={12} />{connected ? "Read E1 schedules" : "Connect Asite"}<ArrowRight size={12} /></button><button className="button text" onClick={() => { setSourceMode("upload"); setModal("source"); }} disabled={scanBusy}>Upload register<ArrowUpRight size={11} /></button></div></section>

          <section className="stats-grid" aria-label="Filtered drawing metrics">
            <MetricCard label="Total planned drawings" value={hasSource ? summary.planned.toLocaleString() : "—"} caption="Rows not marked superseded" Icon={FileText} badge="Template rule" />
            <MetricCard label="Revision 0 submissions" value={hasSource ? summary.rev0Submissions.toLocaleString() : "—"} caption="Initial submission transactions" Icon={Upload} badge="Rev 0" />
            <MetricCard label="Approved submissions" value={hasSource ? summary.approvals.toLocaleString() : "—"} caption="A / B across all revisions" Icon={CheckCheck} badge={hasSource ? `${approvalShare}% of records` : "All revisions"} />
            <MetricCard label="Rework submissions" value={hasSource ? summary.rejections.toLocaleString() : "—"} caption="C / D across all revisions" Icon={RefreshCw} badge={hasSource ? `${(summary.firstTimeApprovalRate * 100).toFixed(1)}% first pass` : "Revision history"} />
          </section>

          <section className="panel filter-panel" aria-label="Dashboard filters"><div className="filter-label"><SlidersHorizontal size={13} />Filter view</div>
            <FilterSelect label="Project" value={filters.project} values={unique(records, "project")} onChange={value => updateFilter("project", value)} />
            <FilterSelect label="Discipline" value={filters.discipline} values={unique(records, "discipline")} onChange={value => updateFilter("discipline", value)} />
            <FilterSelect label="Dashboard row" value={filters.dashboardRow} values={unique(records, "dashboardRow")} onChange={value => updateFilter("dashboardRow", value)} />
            <FilterSelect label="Package" value={filters.package} values={unique(records, "package")} onChange={value => updateFilter("package", value)} />
            <div className="separator" /><label className="search-box"><Search size={12} /><input aria-label="Search scope or drawing" placeholder="Search scope or drawing…" value={filters.search} onChange={event => updateFilter("search", event.target.value)} /></label>{filtersActive && <button className="clear-filters" onClick={() => setFilters(EMPTY_FILTERS)}><X size={10} />Clear</button>}
          </section>

          {tab === "overview" && <><div className="dashboard-grid">
            <section className="panel"><div className="panel-heading"><div><h2>Revision performance</h2><p>Approval and rework across submission revisions</p></div><span className="panel-heading-extra">{summary.maxRevision > 11 ? "Rev 0–11 shown" : "All revisions"}<MoreHorizontal size={14} /></span></div><div className="chart-wrap"><div className="revision-chart" role="img" aria-label={filtered.length ? revisions.map(revision => `Revision ${revision.revision}: ${revision.approved} approvals, ${revision.rejected} rework`).join(". ") : "No revision records yet"}>{revisions.map(revision => <div className="chart-column" key={revision.revision}><div className="bar-group"><div title={`${revision.approved} approvals`} className="bar" style={{ height: `${revision.approved / revisionMax * 88}%`, opacity: filtered.length ? 1 : .25 }} /><div title={`${revision.rejected} rework`} className="bar rework" style={{ height: `${revision.rejected / revisionMax * 88}%`, opacity: filtered.length ? 1 : .25 }} /></div><span className="bar-label">Rev {revision.revision}</span></div>)}</div>{!filtered.length && <div className="chart-empty">{hasSource ? "No records match these filters" : "Your revision story will appear here"}</div>}</div><div className="chart-legend"><span><i className="legend-dot" />Approved · A / B</span><span><i className="legend-dot rework" />Rework · C / D</span></div></section>
            <section className="panel"><div className="panel-heading"><div><h2>Submission outcomes</h2><p>A complete picture of the current filtered view</p></div><span className="badge dim">Transactions</span></div><div className="approval-content"><div className="donut" style={{ "--progress": `${approvalShare}%` } as CSSProperties}><div className="donut-center"><strong>{hasSource ? `${approvalShare}%` : "—"}</strong><small>APPROVED RECORDS</small></div></div><div className="approval-legend"><div className="approval-item"><i className="legend-dot" />Approved<strong>{hasSource ? summary.approvals.toLocaleString() : "—"}</strong></div><div className="approval-item"><i className="legend-dot" style={{ background: "#d7bf96" }} />Rework<strong>{hasSource ? summary.rejections.toLocaleString() : "—"}</strong></div><div className="approval-item"><i className="legend-dot" />Pending / other<strong>{hasSource ? (summary.recordCount - summary.approvals - summary.rejections).toLocaleString() : "—"}</strong></div></div></div><div className="approval-footer"><ShieldCheck size={12} />Totals include transaction rows across all revisions.</div></section>
          </div><section className="panel table-panel"><div className="panel-heading"><div><h2>Drawing approval dashboard<span className="count-pill">{rows.length} {rows.length === 1 ? "row" : "rows"}</span></h2><p>Your Excel layout. Project, scope, and submission history in one table.</p></div><div className="table-actions"><button className="button small" onClick={() => setTab("ledger")}><ClipboardList size={11} /><span>View ledger</span></button><button className="button small" aria-label="Export filtered dashboard" onClick={() => downloadExport()} disabled={!filtered.length || scanBusy || exportBusy}><ArrowDownToLine size={12} /></button></div></div>
            {rows.length ? <div className="table-wrap"><table className="dashboard-table"><thead><tr>{HEADERS.map((header, index) => <th key={index} scope="col">{header}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={`${row.project}-${row.scope}-${row.dashboardRow}-${index}`}>{row.values.map((value, cell) => <td key={cell} title={displayCell(value, cell)}>{cell >= 10 && cell <= 16 && typeof value === "number" && value > 0 ? <span className="cell-number approved">{displayCell(value, cell)}</span> : displayCell(value, cell)}</td>)}</tr>)}</tbody></table></div> : <EmptyState hasSource={hasSource} filtered={filtersActive} onDemo={exploreDemo} />}
            <div className="table-footer"><span><FileSpreadsheet size={11} />{HEADERS.length} columns · Matches the provided workbook</span><span>{rows.length ? "Scroll horizontally for all revision columns" : "Awaiting your E1 drawing registers"}<ArrowRight size={10} /></span></div></section></>}

          {tab === "ledger" && <section className="panel table-panel"><div className="panel-heading"><div><h2>Source revision records<span className="count-pill">{filtered.length.toLocaleString()} records</span></h2><p>Original statuses and revisions, with workbook, sheet, and row references.</p></div><span className="badge dim">Audit view</span></div><div className="ledger-summary"><span>{summary.unknownStatuses} unrecognised statuses</span><span>{summary.unknownRevisions} unknown revisions</span><span>{summary.pending} pending records</span></div>{filtered.length ? <div className="table-wrap"><table className="dashboard-table ledger-table"><thead><tr>{["Drawing number", "Project", "Scope", "Dashboard row", "Discipline", "Package", "Revision", "Status", "Source workbook", "Sheet / row", "Submitted"].map(header => <th key={header} scope="col">{header}</th>)}</tr></thead><tbody>{ledgerRecords.map((record, index) => <tr key={`${record.id}-${index}`}><td title={record.documentNo}>{record.documentNo}</td><td title={record.project}>{record.project}</td><td title={record.scope}>{record.scope}</td><td>{record.dashboardRow}</td><td>{record.discipline || "—"}</td><td>{record.package || "—"}</td><td>{record.revision === null ? "Unknown" : `Rev ${record.revision}`}</td><td title={record.status}><span className={`status-chip ${classify(record.status) === "rejected" ? "rejected" : classify(record.status) === "other" ? "unknown" : ""}`}>{record.status || "Unknown"}</span></td><td title={record.sourceFile}>{record.sourceFile}</td><td>{record.sheet} · {record.rowNumber}</td><td>{record.submittedAt ? new Date(record.submittedAt).toLocaleDateString("en-GB", { timeZone: "Asia/Dubai" }) : "—"}</td></tr>)}</tbody></table></div> : <EmptyState hasSource={hasSource} filtered={filtersActive} onDemo={exploreDemo} />}<div className="table-footer"><span>Showing {filtered.length ? ledgerPage * 50 + 1 : 0}–{Math.min((ledgerPage + 1) * 50, filtered.length)} of {filtered.length.toLocaleString()} records</span><div className="table-actions"><button className="button small" onClick={() => setLedgerPage(page => Math.max(0, page - 1))} disabled={!ledgerPage}>Previous</button><button className="button small" onClick={() => setLedgerPage(page => page + 1)} disabled={(ledgerPage + 1) * 50 >= filtered.length}>Next</button></div></div></section>}
        </>}

        {tab === "connection" && <div className="connection-grid"><section className="panel connection-card"><div className="modal-icon"><Cloud size={22} strokeWidth={1.5} /></div><h2>Asite UAE Cloud</h2><p>Connect once, select your projects, and let E1 Studio read the schedules and their drawing revision history.</p><div className="connection-detail"><span>Connection</span><strong>{connected ? "Connected" : "Not connected"}</strong></div><div className="connection-detail"><span>Authentication</span><strong>{connected ? oauth ? "Asite OAuth · secure server session" : "Host-session key · memory only" : "Asite session sign-in"}</strong></div><div className="connection-detail"><span>Available projects</span><strong>{connected ? projects.length : "—"}</strong></div><div className="connection-detail"><span>Folder scope</span><strong>E1 schedules and descendants</strong></div><div className="disconnect-row">{connected ? <><button className="button primary" onClick={openSource} disabled={scanBusy}><FolderSearch size={13} />Select E1 sources</button><button className="button danger" onClick={disconnect}><LogOut size={12} />Disconnect & clear data</button></> : <button className="button primary" onClick={() => setModal("connect")}><Link2 size={13} />Connect Asite<ArrowRight size={12} /></button>}</div><p className="source-disclosure">Sign in to create an Asite API session, or enter an existing host-session key. Your password is cleared after sign-in; session keys stay in this tab’s memory. Asite browser cookies are not imported automatically.</p></section><section className="panel connection-card"><h2>A single workflow</h2><ol className="connection-steps"><li><span className="step-number">01</span><div><strong>Connect your Asite session</strong>Sign in with your Asite account, or use an existing host-session key.</div></li><li><span className="step-number">02</span><div><strong>Choose your projects</strong>We find the E1 folders and read accessible .xlsx shop drawing registers.</div></li><li><span className="step-number">03</span><div><strong>Review and export</strong>Filter the dashboard, check source notes, and download your Excel report.</div></li></ol><div className="source-disclosure">No Asite connection yet? <button className="link-button" onClick={() => { setSourceMode("upload"); setModal("source"); }}>Upload an E1 register</button> to use the same dashboard locally.</div></section></div>}

        <footer className="footer-row"><span><ShieldCheck size={11} />E1 schedules only · Source history preserved</span><span>Built for clarity. Ready for your next review.</span></footer>
      </main>
    </div>

    <input ref={fileInputRef} type="file" multiple accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" style={{ display: "none" }} onChange={uploadFiles} aria-label="Upload E1 shop drawing register" />
    {modal && <div className="modal-overlay" onMouseDown={event => { if (event.target === event.currentTarget && !connectionBusy && !scanBusy && !exportBusy) setModal(null); }}><div className="modal" ref={modalRef} role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div className="modal-heading"><div><div className="modal-icon">{modal === "connect" ? <Link2 size={21} /> : modal === "source" ? <FolderSearch size={21} /> : modal === "export" ? <FileSpreadsheet size={21} /> : <Sparkles size={21} />}</div><h2 id="modal-title">{modal === "connect" ? "Connect your Asite workspace" : modal === "source" ? "Choose your E1 source" : modal === "export" ? "Review before exporting" : "Your drawing workflow, simplified"}</h2><p>{modal === "connect" ? "One secure connection to your UAE Cloud projects." : modal === "source" ? "Use E1 schedules from Asite, or an existing drawing register." : modal === "export" ? "Your download reflects the current filtered view." : "From the source register to a clear approval dashboard."}</p></div><button className="icon-button" aria-label="Close dialog" onClick={() => setModal(null)} disabled={connectionBusy || scanBusy || exportBusy}><X size={18} /></button></div>

      {modal === "connect" && <><div className="source-tabs" role="tablist" aria-label="Connection method"><button role="tab" aria-selected={connectMode === "session"} className={`source-tab ${connectMode === "session" ? "active" : ""}`} onClick={() => { setConnectMode("session"); setConnectionError(""); }}><UserRound size={13} />Asite sign-in</button><button role="tab" aria-selected={connectMode === "token"} className={`source-tab ${connectMode === "token" ? "active" : ""}`} onClick={() => { setConnectMode("token"); setConnectionError(""); }}><LockKeyhole size={12} />Host-session key</button></div>{connectionError && <div className="modal-error" role="alert">{connectionError}</div>}{connectMode === "session" ? <form onSubmit={event => { event.preventDefault(); void connectSession(); }}><p className="form-description">Sign in to create your Asite UAE API session. We’ll automatically scan E1 schedules in your configured projects after connecting.</p><div className="form-field"><label htmlFor="asite-email">Asite email<span className="badge dim">UAE Cloud</span></label><input id="asite-email" type="email" autoComplete="username" required value={email} onChange={event => setEmail(event.target.value)} placeholder="you@company.com" disabled={connectionBusy} /></div><div className="form-field"><label htmlFor="asite-password">Password</label><input id="asite-password" type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} placeholder="Your Asite password" disabled={connectionBusy} /><small>Cleared after sign-in. Your session key is held only in memory.</small></div><button className="button primary" type="submit" style={{ width: "100%" }} disabled={connectionBusy || !email.trim() || !password}>{connectionBusy ? <Loader2 size={13} className="spin" /> : <Link2 size={13} />}{connectionBusy ? "Signing in to Asite…" : "Sign in & connect"}<ArrowRight size={12} /></button><p className="source-disclosure">If your organisation uses SSO or MFA, direct sign-in may be unavailable. Use your existing host-session key{configured ? " or the organisation’s OAuth connection below" : ""}.</p>{configured && <a className="button" href="/api/asite/auth" style={{ width: "100%", marginTop: 8 }}><ShieldCheck size={13} />Continue with Asite OAuth<ArrowUpRight size={12} /></a>}</form> : <form onSubmit={event => { event.preventDefault(); void connectToken(); }}><p className="form-description">Use an existing Asite UAE host-session API key to access the same project folders. This app cannot automatically read another tab’s Asite cookies.</p><div className="form-field"><label htmlFor="asite-token">Host-session key<span className="badge dim">UAE Cloud</span></label><input id="asite-token" type="password" autoComplete="off" spellCheck={false} value={tokenInput} onChange={event => setTokenInput(event.target.value)} placeholder="Paste your existing session key" disabled={connectionBusy} /><small>Kept in memory only. Reloading or disconnecting clears the key.</small></div><button className="button primary" type="submit" style={{ width: "100%" }} disabled={connectionBusy || !tokenInput.trim()}>{connectionBusy ? <Loader2 size={13} className="spin" /> : <Link2 size={13} />}{connectionBusy ? "Checking project access…" : "Connect workspace"}</button></form>}<div className="modal-footer"><p><LockKeyhole size={12} />Credentials are never included in exports.</p><button className="button text small" onClick={() => { setPassword(""); setSourceMode("upload"); setModal("source"); }}>Upload instead<ArrowRight size={11} /></button></div></>}

      {modal === "source" && <><div className="source-tabs" role="tablist" aria-label="Source type"><button role="tab" aria-selected={sourceMode === "asite"} className={`source-tab ${sourceMode === "asite" ? "active" : ""}`} onClick={() => setSourceMode("asite")}><Cloud size={13} />Asite folders</button><button role="tab" aria-selected={sourceMode === "upload"} className={`source-tab ${sourceMode === "upload" ? "active" : ""}`} onClick={() => setSourceMode("upload")}><Upload size={12} />Upload register</button></div>{error && <div className="modal-error" role="alert">{error}</div>}{sourceMode === "asite" ? connected ? <><div className="form-field"><label htmlFor="source-project">Projects to extract<span className="badge teal">{projects.length} available</span></label><select id="source-project" value={selectedProjects.length === projects.length && projects.length > 1 ? "__all" : selectedProjects[0] ?? ""} onChange={event => { const value = event.target.value; setSelectedProjects(value === "__all" ? projects.map(project => project.id) : value ? [value] : []); setFolders([]); }}><option value="" disabled>Select a project</option>{projects.length > 1 && <option value="__all">All available projects ({projects.length})</option>}{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select><small>Only E1 folders and their descendants will be scanned. Other project folders are excluded.</small></div><button className="button small" onClick={() => previewFolders(selectedProjects[0])} disabled={!selectedProjects.length || folderBusy}>{folderBusy ? <Loader2 size={12} className="spin" /> : <FolderSearch size={12} />}Preview E1 folders{selectedProjects.length > 1 && " · first project"}</button>{folders.length > 0 && <div className="folder-list">{folders.map(folder => <div className="folder-item" key={folder.id}><FolderClosed size={15} /><div><strong>{folder.name}</strong><small>{folder.path}</small></div><Check size={12} style={{ marginLeft: "auto" }} /></div>)}</div>}<p className="source-disclosure">We read the transaction history inside accessible .xlsx shop drawing registers. Latest file metadata alone is not treated as revision history. Unsupported or unreadable sources remain visible as warnings.</p><button className="button primary" style={{ width: "100%", marginTop: 15 }} onClick={scanAsite} disabled={!selectedProjects.length || scanBusy || folderBusy}><Database size={13} />Extract E1 schedules<ArrowRight size={12} /></button></> : <div className="file-upload"><Cloud size={25} strokeWidth={1.5} /><h3>Bring your Asite schedules into view</h3><p>Connect your Asite UAE account first.<br />Then choose a project and we’ll find its E1 folders.</p><button className="button primary" onClick={() => setModal("connect")}><Link2 size={12} />Connect Asite</button></div> : <><div className="form-row"><div className="form-field"><label htmlFor="upload-project">Project name</label><input id="upload-project" value={uploadProject} onChange={event => setUploadProject(event.target.value)} placeholder="e.g. Marina residences" /></div><div className="form-field"><label htmlFor="upload-package">Package <span style={{ color: "#a3b295", fontSize: 9 }}>optional</span></label><input id="upload-package" value={uploadPackage} onChange={event => setUploadPackage(event.target.value)} placeholder="e.g. E1 schedules" /></div></div><div className="file-upload"><FileSpreadsheet size={28} strokeWidth={1.3} /><h3>Your E1 shop drawing register</h3><p>Upload .xlsx files with drawing numbers, revisions, and statuses.<br />The dashboard template is an export layout, not a drawing source.</p><button className="button primary" onClick={() => fileInputRef.current?.click()} disabled={scanBusy}><Upload size={12} />Choose register files</button></div><p className="source-disclosure">Local registers are read in your browser. We keep workbook, sheet, and row references so you can trace the exported counts.</p></>}<div className="modal-footer"><p><ShieldCheck size={12} />A / B approvals · C / D rework</p><button className="button text small" onClick={exploreDemo}>Explore demo<ArrowUpRight size={11} /></button></div></>}

      {modal === "export" && <>{exportError && <div className="modal-error" role="alert">{exportError}</div>}<div className="connection-detail"><span>Dashboard rows</span><strong>{rows.length}</strong></div><div className="connection-detail"><span>Revision records</span><strong>{filtered.length.toLocaleString()}</strong></div><div className="connection-detail"><span>Workbook columns</span><strong>{HEADERS.length} · provided template layout</strong></div>{source.kind === "demo" && <div className="export-note">This workbook contains synthetic demo records. Its filename and source notes will clearly label it as a demo.</div>}{(incomplete || warnings.length > 0) && <div className="export-note"><strong>{incomplete ? "Extraction is incomplete." : "Source warnings need review."}</strong> {warnings.length} warnings were reported. The workbook will include a source note; verify these totals against your registers before sharing.{warnings.slice(0, 3).map((warning, index) => <p key={index} style={{ margin: "7px 0 0" }}>{warning}</p>)}</div>}<div className="modal-footer"><button className="button" onClick={() => setModal(null)} disabled={exportBusy}>Back to dashboard</button><button className="button primary" onClick={() => downloadExport(true)} disabled={exportBusy}>{exportBusy ? <Loader2 size={13} className="spin" /> : <ArrowDownToLine size={13} />}{incomplete ? "Export partial dashboard" : "Export Excel"}</button></div></>}

      {modal === "help" && <><ul className="help-list"><li><Link2 size={15} /><span><strong>Connect or upload.</strong> Sign in to Asite UAE, use an existing host-session key, or upload the underlying E1 shop drawing register.</span></li><li><FolderClosed size={15} /><span><strong>Keep the right scope.</strong> Asite extraction includes E1 folders and their descendants, with .xlsx registers as sources.</span></li><li><FileCheck2 size={15} /><span><strong>Count every transaction.</strong> A / B count as approved and C / D as rework. Approval and rejection totals include every revision.</span></li><li><ListFilter size={15} /><span><strong>Filter once, everywhere.</strong> Project, discipline, dashboard row, package, and search apply to metrics, charts, tables, and exports.</span></li><li><ArrowDownToLine size={15} /><span><strong>Match your Excel layout.</strong> The dashboard keeps the 18 requested columns and the additional KPI columns from your provided workbook.</span></li></ul><p className="source-disclosure">Unknown statuses and revisions are reported in the ledger. Total Planned counts register rows not marked S (superseded), as in your template. Total submissions till approval counts all retained transactions. KPI labels keep the workbook’s formulas; some ratios can exceed 100%.</p><div className="modal-footer"><p><ShieldCheck size={12} />Review source warnings before sharing.</p><button className="button primary" onClick={() => setModal(null)}>Got it<Check size={12} /></button></div></>}
    </div></div>}
  </div>;
}

function MetricCard({ label, value, caption, Icon, badge }: { label: string; value: string; caption: string; Icon: typeof FileText; badge: string }) {
  return <article className="stat-card"><div className="stat-heading"><span>{label}</span><div className="stat-icon"><Icon size={13} strokeWidth={1.6} /></div></div><div className="stat-value">{value}</div><div className="stat-bottom"><span className="stat-caption">{caption}</span><span className="stat-trend">{badge}</span></div></article>;
}
function FilterSelect({ label, value, values, onChange }: { label: string; value: string; values: string[]; onChange: (value: string) => void }) {
  return <select className="field-select" aria-label={`Filter by ${label.toLowerCase()}`} value={value} onChange={event => onChange(event.target.value)}><option value="">All {label === "Dashboard row" ? "dashboard rows" : label.toLowerCase() === "discipline" ? "disciplines" : `${label.toLowerCase()}s`}</option>{values.map(option => <option key={option} value={option}>{option}</option>)}</select>;
}
function EmptyState({ hasSource, filtered, onDemo }: { hasSource: boolean; filtered: boolean; onDemo: () => void }) {
  return <div className="table-empty"><div className="empty-icon"><FileSpreadsheet size={21} strokeWidth={1.3} /></div><strong>{hasSource ? filtered ? "No records match this view" : "No drawing records extracted" : "Your drawing dashboard is ready to begin"}</strong><p>{hasSource ? filtered ? "Try clearing the filters to see all available drawing records." : "Review the source notes, then connect or upload an E1 shop drawing register." : "Add an E1 shop drawing register to see planned drawings, revision outcomes, and approvals in your Excel layout."}</p>{!hasSource && <button className="button text small" onClick={onDemo}>Explore a demo<ArrowUpRight size={10} /></button>}</div>;
}
