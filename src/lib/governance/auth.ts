import { betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { randomBytes } from "node:crypto";
import { getStore } from "./store";
import type { Actor } from "./types";

const runtime = globalThis as unknown as {
  eccAuth?: ReturnType<typeof createWorkspaceAuth>;
  eccAuthReady?: Promise<void>;
  eccDevSecret?: string;
};
export function localMode() {
  return (
    process.env.NODE_ENV !== "production" && process.env.ECC_LOCAL_MODE === "1"
  );
}
export function createWorkspaceAuth(bootstrap = false) {
  const secret =
    process.env.BETTER_AUTH_SECRET ||
    (process.env.NODE_ENV !== "production"
      ? (runtime.eccDevSecret ??= randomBytes(48).toString("hex"))
      : undefined);
  if (!secret || secret.length < 32)
    throw new Error(
      "Configure BETTER_AUTH_SECRET (at least 32 characters) before signing in.",
    );
  return betterAuth({
    database: getStore().db,
    secret,
    baseURL: process.env.BETTER_AUTH_URL || "http://localhost:3000",
    emailAndPassword: {
      enabled: true,
      disableSignUp: !bootstrap,
      minPasswordLength: 12,
    },
    session: { expiresIn: 8 * 60 * 60, updateAge: 30 * 60 },
    rateLimit: { enabled: true, storage: "database", window: 60, max: 20 },
    advanced: {
      cookiePrefix: "ecc",
      useSecureCookies: process.env.NODE_ENV === "production",
    },
    logger: { level: "error" },
  });
}
export async function getAuth() {
  const instance = (runtime.eccAuth ??= createWorkspaceAuth());
  runtime.eccAuthReady ??= (async () => {
    const migration = await getMigrations(instance.options);
    await migration.runMigrations();
  })();
  await runtime.eccAuthReady;
  return instance;
}
export class WorkspaceError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export async function requireActor(headers: Headers): Promise<Actor> {
  if (localMode()) {
    const host = headers.get("host") || "";
    let hostname = "";
    try {
      hostname = new URL(`http://${host}`).hostname;
    } catch {}
    if (!["localhost", "127.0.0.1", "[::1]"].includes(hostname))
      throw new WorkspaceError(
        "Local development mode is restricted to loopback hosts.",
        403,
      );
    return {
      id: "local-owner",
      name: "M. Zaher",
      email: "local@ecc.invalid",
      grants: [{ entityId: "*", projectIds: ["*"], role: "admin" }],
      local: true,
    };
  }
  const auth = await getAuth();
  const session = await auth.api.getSession({ headers });
  if (!session)
    throw new WorkspaceError("Sign in to the governance workspace.", 401);
  const memberships = getStore()
    .all("memberships")
    .filter(
      (m) =>
        m.active !== false &&
        m.email.toLowerCase() === session.user.email.toLowerCase(),
    );
  if (!memberships.length)
    throw new WorkspaceError(
      "Your account needs an ECC entity/project membership.",
      403,
    );
  return {
    id: session.user.id,
    name: session.user.name,
    email: session.user.email,
    grants: memberships.map((m) => ({
      entityId: m.entityId,
      projectIds: m.projectIds,
      role: m.role,
    })),
  };
}
export function sameOrigin(request: Request) {
  const url = new URL(request.url),
    host = request.headers.get("host") || url.host;
  const expected = process.env.ECC_PUBLIC_ORIGIN || `${url.protocol}//${host}`;
  if (request.headers.get("origin") !== expected)
    throw new WorkspaceError("A same-origin request is required.", 403);
}
export async function jsonBody(
  request: Request,
): Promise<Record<string, unknown>> {
  const reader = request.body?.getReader();
  if (!reader) throw new WorkspaceError("A JSON body is required.");
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > 2_000_000) {
      await reader.cancel();
      throw new WorkspaceError(
        "The import exceeds the 2 MB request limit.",
        413,
      );
    }
    chunks.push(value);
  }
  let body: unknown;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new WorkspaceError("A valid JSON object is required.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new WorkspaceError("A JSON object is required.");
  return body as Record<string, unknown>;
}
