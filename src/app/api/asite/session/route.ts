import { NextRequest, NextResponse } from "next/server";
import { oauthConfigured, openSession, SESSION_COOKIE } from "@/lib/session";
import { listProjects } from "@/lib/asite";

export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  const session = openSession(request.cookies.get(SESSION_COOKIE)?.value);
  const configured = oauthConfigured();
  if (!session) return NextResponse.json({ configured, connected: false, region: "uae" }, {headers: {"Cache-Control":"no-store"}});
  try {
    const projects = await listProjects(session.accessToken, "uae", "oauth");
    return NextResponse.json({ configured, connected: true, region: "uae", projects }, {headers: {"Cache-Control":"no-store"}});
  } catch {
    return NextResponse.json({ configured, connected: false, region: "uae", error: "Your Asite session is unavailable or has expired. Sign in again." }, {headers: {"Cache-Control":"no-store"}});
  }
}
