import { NextRequest, NextResponse } from "next/server";
import { readApiRequest, apiError } from "@/lib/http";
import { listProjects } from "@/lib/asite";
export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  try {
    const {token, region, authType} = await readApiRequest(request);
    return NextResponse.json({projects: await listProjects(token, region, authType)});
  } catch (error) { return apiError(error); }
}
