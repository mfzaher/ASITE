import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { cookieOptions, oauthConfigured, STATE_COOKIE } from "@/lib/session";

export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  if (!oauthConfigured()) return NextResponse.redirect(new URL("/?connectionError=Sign-in%20requires%20the%20application%20owner%20to%20configure%20the%20Asite%20OAuth%20integration.%20You%20can%20use%20an%20existing%20API%20access%20token%20instead.", request.url));
  const state = randomBytes(32).toString("base64url");
  const auth = new URL("https://oauthuae.asite.com/oauth/authorize");
  auth.search = new URLSearchParams({
    response_type: "code", client_id: process.env.ASITE_CLIENT_ID!,
    redirect_uri: new URL("/api/asite/callback", request.url).toString(),
    scope: "DOCUMENT_READ", state
  }).toString();
  const response = NextResponse.redirect(auth);
  response.cookies.set(STATE_COOKIE, state, { ...cookieOptions(), maxAge: 600 });
  return response;
}
