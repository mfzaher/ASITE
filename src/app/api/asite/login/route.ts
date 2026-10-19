import { NextRequest, NextResponse } from "next/server";
import { loginSession, listProjects } from "@/lib/asite";
import { apiError, textField } from "@/lib/http";
export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  try {
    const origin = request.headers.get("origin");
    if (origin && origin !== (process.env.ECC_PUBLIC_ORIGIN || `${request.nextUrl.protocol}//${request.headers.get("host") || request.nextUrl.host}`)) throw new Error("Requests must come from this application.");
    if (Number(request.headers.get("content-length") ?? "0") > 16000) throw new Error("Login request is too large.");
    const body = await request.json() as Record<string, unknown>;
    if (body.region !== "uae") throw new Error("Select Asite UAE Cloud.");
    const {token} = await loginSession(textField(body, "email"), textField(body, "password"), "uae");
    const projects = await listProjects(token, "uae", "session");
    return NextResponse.json({ sessionId: token, projects }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}
