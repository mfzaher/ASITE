import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { openSession, SESSION_COOKIE } from "./session";
import { AsiteError } from "./asite";

export function failure(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}
export async function readApiRequest(request: NextRequest): Promise<{body: Record<string, unknown>; token: string; region: "uae"; authType: "session" | "oauth"}> {
  const origin = request.headers.get("origin");
  if (origin && origin !== (process.env.ECC_PUBLIC_ORIGIN || `${request.nextUrl.protocol}//${request.headers.get("host") || request.nextUrl.host}`)) throw new Error("Requests must come from this application.");
  if (Number(request.headers.get("content-length") ?? "0") > 64000) throw new Error("Request is too large.");
  const body = await request.json() as Record<string, unknown>;
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("A JSON request is required.");
  const session = openSession((await cookies()).get(SESSION_COOKIE)?.value);
  const suppliedToken = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
  const token = suppliedToken || session?.accessToken;
  if (!token || token.length > 8000 || /[\r\n;]/.test(token)) throw new Error("Sign in to Asite UAE or enter a valid host-session key.");
  if (body.region !== undefined && body.region !== "uae") throw new Error("This application connects to Asite UAE Cloud.");
  const authType = suppliedToken ? body.authType === "oauth" ? "oauth" : "session" : "oauth";
  return { body, token, region: "uae", authType };
}
export function textField(body: Record<string, unknown>, name: string): string {
  const value = body[name];
  if (typeof value !== "string" || !value.trim() || value.length > 3000) throw new Error(`${name} is required.`);
  return value;
}
export function apiError(error: unknown) {
  // Never echo upstream response bodies or request headers; these may contain credentials.
  const safeError = error as {status?: number; message?: string};
  if (error instanceof AsiteError) return NextResponse.json({ error: error.message, code: error.code, diagnostic: error.diagnostic }, { status: error.status || 400, headers: { "Cache-Control": "no-store" } });
  return failure(safeError.message || "The Asite request could not be completed.", safeError.status || 400);
}
