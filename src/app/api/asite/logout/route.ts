import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, STATE_COOKIE } from "@/lib/session";
export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (origin && origin !== (process.env.ECC_PUBLIC_ORIGIN || `${request.nextUrl.protocol}//${request.headers.get("host") || request.nextUrl.host}`)) return NextResponse.json({error: "Requests must come from this application."}, {status: 403});
  const response = NextResponse.json({ connected: false });
  response.cookies.delete(SESSION_COOKIE);
  response.cookies.delete(STATE_COOKIE);
  return response;
}
