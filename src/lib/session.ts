import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export const SESSION_COOKIE = "asite_e1_session";
export const STATE_COOKIE = "asite_e1_oauth_state";
export type AsiteSession = { accessToken: string; expiresAt: number; region: "uae" };

function key(): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("The application owner must configure SESSION_SECRET with at least 32 characters.");
  return createHash("sha256").update(secret).digest();
}
export function sealSession(session: AsiteSession): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(session), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64url");
}
export function openSession(value?: string): AsiteSession | null {
  if (!value || value.length > 12000) return null;
  try {
    const data = Buffer.from(value, "base64url");
    const decipher = createDecipheriv("aes-256-gcm", key(), data.subarray(0, 12));
    decipher.setAuthTag(data.subarray(12, 28));
    const session = JSON.parse(Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString("utf8")) as AsiteSession;
    if (typeof session.accessToken !== "string" || session.region !== "uae" || session.expiresAt <= Date.now()) return null;
    return session;
  } catch { return null; }
}
export function oauthConfigured(): boolean {
  return Boolean(process.env.ASITE_CLIENT_ID && process.env.ASITE_CLIENT_SECRET && (process.env.SESSION_SECRET?.length ?? 0) >= 32);
}
export function cookieOptions() {
  return { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/" };
}
