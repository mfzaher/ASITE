import { getAuth } from "@/lib/governance/auth";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handle(request: Request) {
  try {
    return await (await getAuth()).handler(request);
  } catch {
    return Response.json(
      {
        error:
          "Workspace authentication is not ready. Run npm run setup and configure BETTER_AUTH_SECRET and BETTER_AUTH_URL.",
      },
      { status: 503 },
    );
  }
}
export const GET = handle;
export const POST = handle;
