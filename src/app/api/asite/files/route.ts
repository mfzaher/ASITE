import { NextRequest, NextResponse } from "next/server";
import { readApiRequest, apiError, textField } from "@/lib/http";
import { listFiles } from "@/lib/asite";
export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  try {
    const {body, token, region, authType} = await readApiRequest(request);
    if (!Array.isArray(body.folderIds) || body.folderIds.length === 0 || body.folderIds.length > 1000 || body.folderIds.some(id => typeof id !== "string")) throw new Error("Select accessible E1 folders.");
    const cursor = typeof body.cursor === "string" ? body.cursor : undefined;
    return NextResponse.json({files: await listFiles(token, region, textField(body, "projectId"), body.folderIds as string[], cursor, authType)});
  } catch (error) { return apiError(error); }
}
