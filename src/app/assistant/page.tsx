"use client";

import "./assistant.css";

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowLeft, ArrowUp, Bot, CheckCircle2, ChevronDown, CircleAlert,
  Clock3, ExternalLink, FileSearch, LockKeyhole, RotateCcw,
  ShieldCheck, Sparkles, Users, X,
} from "lucide-react";

type Project = { id: string; code: string; name: string; entityId: string };
type Snapshot = { projects: Project[]; actor: { name: string }; readiness: { ai: boolean } };
type Citation = { id: string; title: string; kind: string; url: string };
type Answer = {
  answer: string;
  status: "answered" | "limited" | "unavailable";
  mode: "calculated" | "ai-grounded" | "source-excerpts" | "unavailable";
  month: string;
  coverage: string;
  citations: Citation[];
  warning?: string;
};
type Entry = { id: number; role: "user" | "assistant"; content: string; result?: Answer; error?: boolean };

const suggested = [
  { icon: Users, title: "Monthly access", query: "Which project had the highest number of active users last month?" },
  { icon: Clock3, title: "Inactive accounts", query: "How many assigned accounts have had no login in two months?" },
  { icon: ShieldCheck, title: "Open observations", query: "Show open findings and observations across all projects." },
  { icon: FileSearch, title: "Approval status", query: "What percentage of shop drawings were approved?" },
];
const currentMonth = (() => {
  const parts = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", timeZone: "Asia/Dubai" }).formatToParts(new Date());
  return `${parts.find((p) => p.type === "year")?.value}-${parts.find((p) => p.type === "month")?.value}`;
})();
function previousMonth(month: string) {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
}
function formatMonth(month: string) {
  const [y, m] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, 1)));
}
function safeHref(url: string): string | undefined {
  if (url.startsWith("/api/control/")) return url;
  try { const parsed = new URL(url); if (parsed.protocol === "https:") return parsed.toString(); } catch {}
  return undefined;
}

export default function AssistantPage() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loadError, setLoadError] = useState("");
  const [month, setMonth] = useState(previousMonth(currentMonth));
  const [projects, setProjects] = useState<string[]>([]);
  const [picker, setPicker] = useState(false);
  const [message, setMessage] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [busy, setBusy] = useState(false);
  const [callError, setCallError] = useState("");
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/control/snapshot", { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Workspace access unavailable.");
        if (active) setSnapshot(result);
      })
      .catch((err) => { if (active) setLoadError((err as Error).message); });
    return () => { active = false; };
  }, []);
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [entries, busy]);
  const available = (snapshot?.projects || []).filter((p) => !p.entityId.startsWith("demo-") && !p.id.startsWith("demo-"));
  const selectedProjects = projects.length ? projects.length + " projects" : "All accessible projects";

  async function send(question: string) {
    const q = question.trim();
    if (!q || busy || q.length > 1000) return;
    setBusy(true);
    setCallError("");
    setMessage("");
    setEntries((items) => [...items, { id: Date.now(), role: "user", content: q }]);
    try {
      const response = await fetch("/api/control/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q, month, projectIds: projects }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Assistant unavailable.");
      setEntries((items) => [...items, { id: Date.now() + 1, role: "assistant", content: result.answer, result }]);
    } catch (error) {
      const text = (error as Error).message;
      setCallError(text);
      setEntries((items) => [...items, { id: Date.now() + 1, role: "assistant", content: text, error: true }]);
    } finally {
      setBusy(false);
    }
  }
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); void send(message); }
  function toggle(id: string) {
    setProjects((old) => old.includes(id) ? old.filter((p) => p !== id) : [...old, id]);
  }
  return (
    <div className="ecca-shell">
      <aside className="ecca-sidebar">
        <a href="/" className="ecca-brand" aria-label="ECC workspace home">
          <span className="ecca-brand-icon">E</span>
          <span><strong>ECC</strong><small>INFORMATION GOVERNANCE</small></span>
        </a>
        <div className="ecca-nav-label">WORKSPACE</div>
        <a href="/" className="ecca-link"><ArrowLeft size={17}/> Control center</a>
        <div className="ecca-nav-selected"><Sparkles size={17}/> ECC Intelligence</div>
        <a href="/registers" className="ecca-link"><FileSearch size={17}/> Drawing register</a>
        <div className="ecca-sidebar-foot">
          <div className="ecca-security"><LockKeyhole size={15}/> Project-scoped access</div>
          <span>{snapshot?.actor.name || "ECC workspace"}</span>
          <small>Read-only assistant · No Asite writes</small>
        </div>
      </aside>

      <main className="ecca-main">
        <header className="ecca-topbar">
          <div className="ecca-top-title"><Sparkles size={17}/><span>ECC Intelligence</span><span className="ecca-beta">WORKSPACE ASSISTANT</span></div>
          <div className="ecca-top-right"><span className="ecca-status-dot"/> Evidence-first mode</div>
        </header>
        <div className="ecca-content">
          <section className="ecca-intro">
            <div><div className="ecca-kicker">INTELLIGENCE / ECC</div>
              <h1>Ask your project data.</h1>
              <p>Explore governance activity, project performance and exceptions through source-backed answers.</p>
            </div>
            <span className="ecca-readonly"><ShieldCheck size={16}/> Read-only</span>
          </section>
          <section className="ecca-controls" aria-label="Assistant filters">
            <div className="ecca-control-group">
              <span>PROJECT SCOPE</span>
              <div className="ecca-picker-wrap">
                <button className="ecca-selector" onClick={() => setPicker(!picker)} aria-expanded={picker} aria-label="Choose projects">
                  {selectedProjects}<ChevronDown size={15}/>
                </button>
                {picker && <div className="ecca-picker">
                  <button className="ecca-clear" onClick={() => { setProjects([]); setPicker(false); }}>All accessible projects</button>
                  {available.length === 0 && <p>No project records are available.</p>}
                  {available.map((p) => <label key={p.id}>
                    <input type="checkbox" checked={projects.includes(p.id)} onChange={() => toggle(p.id)}/>
                    {p.code || p.name}<span>{p.name}</span>
                  </label>)}
                  <button className="ecca-done" onClick={() => setPicker(false)}>Apply selection</button>
                </div>}
              </div>
            </div>
            <div className="ecca-control-group"><span>REPORTING MONTH</span>
              <input type="month" max={currentMonth} value={month} onChange={(event) => setMonth(event.target.value)} aria-label="Reporting month" />
            </div>
            <div className="ecca-control-meta"><Clock3 size={15}/> {formatMonth(month)}<span>·</span> Dubai timezone</div>
          </section>
          {loadError && <div className="ecca-warning"><CircleAlert size={16}/> {loadError} <a href="/">Sign in or open workspace</a></div>}
          <div className="ecca-chat-region" aria-live="polite">
            {entries.length === 0 && <div className="ecca-empty-state">
              <div className="ecca-orb"><Bot size={31} strokeWidth={1.5}/></div>
              <div className="ecca-empty-label">YOUR ECC ANALYSIS ASSISTANT</div>
              <h2>What would you like to know?</h2>
              <p>Start with one of these questions. Answers will distinguish verified workspace records from unavailable ASITE data.</p>
              <div className="ecca-starters">
                {suggested.map((item) => <button key={item.title} onClick={() => void send(item.query)} disabled={busy || !!loadError || !snapshot}>
                  <item.icon size={19}/><span><strong>{item.title}</strong><small>{item.query}</small></span><ArrowUp size={15}/></button>)}
              </div>
            </div>}
            {entries.length > 0 && <div className="ecca-messages">
              {entries.map((entry) => <article key={entry.id} className={entry.role === "user" ? "ecca-message ecca-user" : "ecca-message ecca-assistant"}>
                <div className="ecca-message-avatar">{entry.role === "user" ? "YOU" : <Sparkles size={17}/>}</div>
                <div className="ecca-message-body"><div className="ecca-message-byline">{entry.role === "user" ? "You" : "ECC Intelligence"}</div>
                  <div className="ecca-message-text">{entry.content}</div>
                  {entry.result && <div className="ecca-evidence">
                    <div className="ecca-evidence-heading">
                      <span className={entry.result.status === "answered" ? "ecca-confirmed" : "ecca-limited"}>
                        {entry.result.status === "answered" ? <CheckCircle2 size={14}/> : <CircleAlert size={14}/>}
                        {entry.result.status === "answered" ? "Calculated from workspace" : entry.result.status === "limited" ? "Limited coverage" : "Source unavailable"}
                      </span>
                      <span>{entry.result.mode} · {entry.result.month}</span>
                    </div>
                    {entry.result.citations.length > 0 && <div className="ecca-sources"><strong>Source records</strong>
                      {entry.result.citations.map((source) => {
                        const href = safeHref(source.url);
                        return href && <a href={href} key={source.id} target="_blank" rel="noopener noreferrer">
                          <FileSearch size={14}/>{source.title}<ExternalLink size={13}/>
                        </a>;
                      })}
                    </div>}
                    <p>{entry.result.coverage}</p>
                    {entry.result.warning && <p className="ecca-caution">{entry.result.warning}</p>}
                  </div>}
                </div>
              </article>)}
              {busy && <div className="ecca-thinking"><span className="ecca-pulse"/> Checking available evidence…</div>}
              <div ref={bottom}/>
            </div>}
          </div>
          <div className="ecca-composer-area">
            {callError && <div className="ecca-inline-error"><CircleAlert size={14}/>{callError}<button aria-label="Dismiss error" onClick={() => setCallError("")}><X size={13}/></button></div>}
            <form className="ecca-composer" onSubmit={submit}>
              <textarea aria-label="Ask ECC Intelligence" placeholder="Ask about access activity, observations, project comparisons…" rows={2}
                value={message} maxLength={1000} onChange={(e) => setMessage(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (message.trim()) void send(message); } }}/>
              <button type="submit" title="Send question" aria-label="Send question" disabled={busy || !message.trim() || !snapshot || !!loadError}><ArrowUp size={19}/></button>
            </form>
            <div className="ecca-composer-footer">
              <span><LockKeyhole size={12}/> No write actions · Project access enforced server-side</span>
              <button onClick={() => { setEntries([]); setCallError(""); }} disabled={!entries.length || busy}><RotateCcw size={12}/> New conversation</button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
