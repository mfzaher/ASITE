import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { cookieOptions, oauthConfigured, sealSession, SESSION_COOKIE, STATE_COOKIE } from "@/lib/session";

export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  const state = request.nextUrl.searchParams.get("state") || "";
  const savedState = request.cookies.get(STATE_COOKIE)?.value || "";
  const code = request.nextUrl.searchParams.get("code");
  const fail = (message: string) => {
    const response = NextResponse.redirect(new URL(`/?connectionError=${encodeURIComponent(message)}`, request.url));
    response.cookies.delete(STATE_COOKIE);
    return response;
  };
  if (!oauthConfigured()) return fail("Asite sign-in has not been configured by the application owner.");
  if (!/^[A-Za-z0-9_-]{43}$/.test(state) || !/^[A-Za-z0-9_-]{43}$/.test(savedState) || !timingSafeEqual(Buffer.from(state), Buffer.from(savedState))) return fail("Sign-in expired or could not be verified. Please try again.");
  if (!code || request.nextUrl.searchParams.has("error")) return fail("Asite authorization was not completed.");
  try {
    const response = await fetch("https://oauthuae.asite.com/oauth/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ grant_type: "authorization_code", code,
        redirect_uri: new URL("/api/asite/callback", request.url).toString(),
        client_id: process.env.ASITE_CLIENT_ID!, client_secret: process.env.ASITE_CLIENT_SECRET! }),
      signal: AbortSignal.timeout(20000), cache: "no-store", redirect: "error"
    });
    if (!response.ok) return fail("Asite could not authorize this application. Check the registered callback URL and integration permissions.");
    const data = await response.json() as {access_token?: string; expires_in?: number};
    if (!data.access_token || data.access_token.length > 6000) return fail("Asite did not return a usable access token.");
    const lifetime = Math.min(Math.max(Number(data.expires_in) || 3600, 60), 86400);
    const result = NextResponse.redirect(new URL("/?connected=1", request.url));
    result.cookies.set(SESSION_COOKIE, sealSession({ accessToken: data.access_token, region: "uae", expiresAt: Date.now() + lifetime * 1000 }), { ...cookieOptions(), maxAge: lifetime });
    result.cookies.delete(STATE_COOKIE);
    return result;
  } catch { return fail("Asite authorization could not be reached. Please try again."); }
}
