import { NextRequest, NextResponse } from "next/server";
import { readApiRequest, apiError, textField } from "@/lib/http";
import { listFolders } from "@/lib/asite";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: NextRequest) {
  try {
    const {body, token, region, authType} = await readApiRequest(request);
    return NextResponse.json({folders: await listFolders(token, region, textField(body, "projectId"), authType)});
  } catch (error) { return apiError(error); }
}
