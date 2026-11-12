import { requireActor, sameOrigin, jsonBody, WorkspaceError } from "@/lib/governance/auth";
import { getStore } from "@/lib/governance/store";
import { answerWorkspaceAssistant } from "@/lib/governance/assistant";
import { snapshot } from "@/lib/governance/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const actor = await requireActor(request.headers);
    const store = getStore();
    if (!store.consumeBudget(`${actor.id}:assistant`, 15))
      throw new WorkspaceError("Assistant rate limit reached. Try again shortly.", 429);
    const body = await jsonBody(request);
    if (typeof body.query !== "string")
      throw new WorkspaceError("Enter a question.");
    if (body.projectIds !== undefined &&
      (!Array.isArray(body.projectIds) || body.projectIds.some((id: unknown) => typeof id !== "string")))
      throw new WorkspaceError("Project selection must be a list.");
    if (body.month !== undefined && typeof body.month !== "string")
      throw new WorkspaceError("Month must use YYYY-MM.");
    const result = await answerWorkspaceAssistant(store, actor, snapshot(store, actor), {
      query: body.query,
      projectIds: body.projectIds as string[] | undefined,
      month: body.month as string | undefined,
    });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof WorkspaceError ? error.status : 500;
    return Response.json(
      { error: error instanceof WorkspaceError ? error.message : "The assistant request failed. Please retry." },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  }
}
