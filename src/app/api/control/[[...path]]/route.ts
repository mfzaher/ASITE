import { timingSafeEqual } from "node:crypto";
import {
  requireActor,
  sameOrigin,
  jsonBody,
  WorkspaceError,
} from "@/lib/governance/auth";
import { getStore } from "@/lib/governance/store";
import {
  may,
  previousMonth,
  rulesFor,
  validateGate,
} from "@/lib/governance/engine";
import { loadDemo } from "@/lib/governance/demo";
import { answerQuestion, retrieve } from "@/lib/governance/retrieval";
import * as service from "@/lib/governance/service";
import type { Actor } from "@/lib/governance/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ path?: string[] }> };
function reply(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
function errorResponse(error: unknown) {
  return reply(
    {
      error:
        error instanceof WorkspaceError
          ? error.message
          : "The workspace request could not be completed. Check the application setup and retry.",
    },
    error instanceof WorkspaceError ? error.status : 500,
  );
}
function matchesSecret(
  value: string | null,
  secret: string | undefined,
): boolean {
  if (!value || !secret || secret.length < 32) return false;
  const expected = Buffer.from(`Bearer ${secret}`),
    actual = Buffer.from(value);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
async function reportingActor(request: Request): Promise<Actor> {
  if (
    matchesSecret(
      request.headers.get("authorization"),
      process.env.ECC_REPORTING_TOKEN,
    )
  ) {
    const entityIds = (process.env.ECC_REPORTING_ENTITIES || "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s && s !== "*");
    if (!entityIds.length)
      throw new WorkspaceError(
        "Reporting token needs explicit entity scopes.",
        403,
      );
    return {
      id: "powerbi-service",
      name: "Power BI reporting",
      email: "reporting@ecc.invalid",
      grants: entityIds.map((entityId) => ({
        entityId,
        projectIds: ["*"],
        role: "viewer",
      })),
    };
  }
  return requireActor(request.headers);
}
function csv(records: Record<string, unknown>[]): string {
  const keys = [...new Set(records.flatMap((r) => Object.keys(r)))];
  const cell = (value: unknown) => {
    let s =
      value == null
        ? ""
        : typeof value === "object"
          ? JSON.stringify(value)
          : String(value);
    if (/^[\s]*[=+@-]/.test(s)) s = "'" + s;
    return '"' + s.replaceAll('"', '""') + '"';
  };
  return (
    "\uFEFF" +
    [
      keys.map(cell).join(","),
      ...records.map((row) => keys.map((k) => cell(row[k])).join(",")),
    ].join("\r\n")
  );
}
export async function GET(request: Request, context: Context) {
  try {
    const path = (await context.params).path || [],
      url = new URL(request.url);
    if (path[0] === "health")
      return reply({ status: "ok", database: "sqlite", version: "0.1.0" });
    const actor =
        path[0] === "export"
          ? await reportingActor(request)
          : await requireActor(request.headers),
      store = getStore();
    if (!path.length || path[0] === "snapshot")
      return reply(service.snapshot(store, actor));
    if (path[0] === "evidence" && path[1]) {
      const source = store.get("sources", path[1]);
      if (!source || !may(actor, source))
        throw new WorkspaceError(
          "Source not found in your permitted scope.",
          404,
        );
      return new Response(
        `${source.sampleData ? "FICTIONAL DEMONSTRATION SOURCE\n\n" : ""}${source.title}\nRevision: ${source.revision}\n\n${source.content}`,
        {
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "no-store",
            "Content-Security-Policy": "default-src 'none'",
          },
        },
      );
    }
    if (path[0] === "audits" && path[1] && path[2] === "pack") {
      const pack = service.evidencePack(store, actor, path[1]);
      return new Response(JSON.stringify(pack, null, 2), {
        headers: {
          "Content-Type": "application/json",
          "Content-Disposition": `attachment; filename="ECC-audit-${pack.audit.month}-evidence.json"`,
          "Cache-Control": "no-store",
        },
      });
    }
    if (path[0] === "export") {
      const table = url.searchParams.get("table") || "submissions",
        data = service.snapshot(store, actor);
      if (
        ![
          "submissions",
          "findings",
          "audits",
          "access",
          "risks",
          "lessons",
        ].includes(table)
      )
        throw new WorkspaceError("Unsupported reporting table.");
      const values = (
        data[table as "submissions"] as unknown as Record<string, unknown>[]
      )
        .filter(
          (r) =>
            (!url.searchParams.get("entity") ||
              r.entityId === url.searchParams.get("entity")) &&
            (!url.searchParams.get("project") ||
              r.projectId === url.searchParams.get("project")),
        )
        .map((row) => {
          const filtered = { ...row };
          delete filtered.snapshots;
          delete filtered.accessSnapshots;
          if (table === "submissions") {
            const submission = data.submissions.find((s) => s.id === row.id)!;
            const gate = validateGate(
              submission,
              rulesFor(submission, data.rules),
            );
            filtered.gatePassed = gate.passed;
            filtered.gateIssueCount = gate.issues.length;
            filtered.ruleVersion = gate.ruleVersion;
          }
          return filtered;
        });
      return new Response(csv(values), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="ECC-${table}.csv"`,
          "Cache-Control": "no-store",
        },
      });
    }
    throw new WorkspaceError("Endpoint not found.", 404);
  } catch (error) {
    return errorResponse(error);
  }
}
export async function POST(request: Request, context: Context) {
  try {
    const path = (await context.params).path || [],
      store = getStore();
    if (path[0] === "cron") {
      if (
        !matchesSecret(
          request.headers.get("authorization"),
          process.env.ECC_CRON_SECRET,
        )
      )
        throw new WorkspaceError("Scheduled audit authorization failed.", 401);
      const entityIds = (process.env.ECC_AUDIT_ENTITIES || "")
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s && s !== "*");
      if (!entityIds.length)
        throw new WorkspaceError("Configure explicit ECC_AUDIT_ENTITIES.", 503);
      const actor: Actor = {
        id: "scheduled-audit-service",
        name: "H.O. monthly audit service",
        email: "audits@ecc.invalid",
        grants: entityIds.map((entityId) => ({
          entityId,
          projectIds: ["*"],
          role: "qa_manager",
        })),
      };
      const audits = service.runAudits(store, actor),
        alerts = service.refreshAlerts(store, actor);
      let ncrDrafts = 0;
      for (const f of store
        .all("findings")
        .filter(
          (f) =>
            may(actor, f, "qa_manager") &&
            f.status === "observation_issued" &&
            f.dueDate &&
            Date.parse(f.dueDate) < Date.now(),
        )) {
        service.transitionFinding(store, actor, f.id, "ncr", {});
        ncrDrafts++;
      }
      return reply({
        month: previousMonth(),
        audits: audits.map((a) => ({
          id: a.id,
          reused: a.reused,
          findings: a.findingCount,
        })),
        alerts: alerts.created,
        ncrDrafts,
        officialNcrsIssued: 0,
      });
    }
    sameOrigin(request);
    const actor = await requireActor(request.headers),
      body = await jsonBody(request);
    if (
      (path[0] === "ask" || path[0] === "imports" || path[2] === "recommend") &&
      !store.consumeBudget(
        `${actor.id}:${path[0]}`,
        path[0] === "imports" ? 10 : 20,
      )
    )
      throw new WorkspaceError(
        "Too many requests. Please wait a minute and try again.",
        429,
      );
    if (path[0] === "demo") return reply(loadDemo(store, actor));
    if (path[0] === "entities")
      return reply(service.saveEntity(store, actor, body), 201);
    if (path[0] === "projects")
      return reply(service.saveProject(store, actor, body), 201);
    if (path[0] === "submissions") {
      if (!path[1])
        return reply(service.saveSubmission(store, actor, body), 201);
      if (path[2] === "review")
        return reply(service.reviewSubmission(store, actor, path[1]));
      if (path[2] === "submit")
        return reply(service.submitSubmission(store, actor, path[1]));
    }
    if (path[0] === "rules")
      return reply(
        path[1] && path[2] === "approve"
          ? service.approveRules(store, actor, path[1])
          : service.saveRules(store, actor, body),
      );
    if (path[0] === "audits")
      return reply(
        service.runAudits(
          store,
          actor,
          service.text(body, "month", false) || previousMonth(),
        ),
      );
    if (path[0] === "findings" && path[1] && path[2])
      return reply(
        service.transitionFinding(store, actor, path[1], path[2], body),
      );
    if (path[0] === "lessons")
      return reply(
        path[1] && path[2] === "approve"
          ? service.approveLesson(store, actor, path[1])
          : service.saveLesson(store, actor, body),
        201,
      );
    if (path[0] === "ask")
      return reply(
        await answerQuestion(
          store,
          actor,
          service.text(body, "query", true, 1000),
          service.text(body, "entityId", false, 150) || undefined,
          service.text(body, "projectId", false, 150) || undefined,
        ),
      );
    if (path[0] === "risks") {
      if (!path[1]) return reply(service.saveRisk(store, actor, body), 201);
      const risk = store.get("risks", path[1]);
      if (!risk) throw new WorkspaceError("Risk not found.", 404);
      service.authorize(actor, risk);
      if (path[2] === "recommend")
        return reply(
          await retrieve(
            store,
            actor,
            `${risk.title} ${risk.description}`,
            risk.entityId,
            risk.projectId,
          ),
        );
      if (path[2] === "link")
        return reply(
          service.linkRisk(
            store,
            actor,
            path[1],
            service.text(body, "lessonId"),
          ),
        );
    }
    if (path[0] === "processes")
      return reply(service.saveProcess(store, actor, body), 201);
    if (path[0] === "access")
      return reply(service.saveAccess(store, actor, body), 201);
    if (path[0] === "memberships")
      return reply(
        path[1] && path[2] === "revoke"
          ? service.revokeMembership(store, actor, path[1])
          : service.saveMembership(store, actor, body),
        201,
      );
    if (path[0] === "imports")
      return reply(service.importRecords(store, actor, body), 201);
    if (path[0] === "alerts")
      return reply(
        path[1]
          ? service.acknowledgeAlert(store, actor, path[1])
          : service.refreshAlerts(store, actor),
      );
    throw new WorkspaceError("Endpoint not found.", 404);
  } catch (error) {
    return errorResponse(error);
  }
}
