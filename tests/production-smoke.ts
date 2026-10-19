import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";

async function main() {
  const dir = mkdtempSync(join(tmpdir(), "ecc-production-smoke-")),
    origin = "http://127.0.0.1:3001",
    password = randomBytes(24).toString("hex");
  process.env.ECC_DATABASE_PATH = join(dir, "workspace.sqlite");
  process.env.BETTER_AUTH_SECRET = randomBytes(48).toString("hex");
  process.env.SESSION_SECRET = randomBytes(48).toString("hex");
  process.env.BETTER_AUTH_URL = origin;
  process.env.ECC_PUBLIC_ORIGIN = origin;
  const { createWorkspaceAuth } = await import("../src/lib/governance/auth");
  const { getStore } = await import("../src/lib/governance/store");
  const { getMigrations } = await import("better-auth/db/migration");
  const { loadDemo } = await import("../src/lib/governance/demo");
  const db = getStore(),
    auth = createWorkspaceAuth(true);
  await (await getMigrations(auth.options)).runMigrations();
  await auth.api.signUpEmail({
    body: {
      email: "viewer@smoke.example",
      password,
      name: "Smoke test viewer",
    },
  });
  loadDemo(db, {
    id: "smoke-owner",
    name: "Synthetic owner",
    email: "owner@smoke.example",
    grants: [{ entityId: "*", projectIds: ["*"], role: "admin" }],
  });
  db.save("memberships", {
    id: "smoke-membership",
    entityId: "demo-entity-1",
    email: "viewer@smoke.example",
    name: "Smoke test viewer",
    role: "viewer",
    projectIds: ["demo-project-1"],
    active: true,
  });
  db.close();
  const server = spawn(process.execPath, ["scripts/start.mjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
        NODE_ENV: "production",
      PORT: "3001",
      ECC_BIND_HOST: "127.0.0.1",
      ECC_LOCAL_MODE: "1",
      NEXT_TELEMETRY_DISABLED: "1",
    },
    stdio: ["ignore", "ignore", "ignore"],
  });
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      if (server.exitCode !== null)
        throw new Error("Production server exited before it became ready.");
      try {
        if ((await fetch(`${origin}/api/control/health`)).ok) {
          ready = true;
          break;
        }
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(ready, "Production health endpoint must become ready.");
    assert.equal(
      (await fetch(`${origin}/api/control/snapshot`)).status,
      401,
      "Production must ignore the local-mode bypass flag.",
    );
    const login = await fetch(`${origin}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ email: "viewer@smoke.example", password }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
    assert.ok(cookie);
    const response = await fetch(`${origin}/api/control/snapshot`, {
      headers: { cookie },
    });
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.submissions.length, 9);
    assert.ok(
      data.submissions.every(
        (s: { entityId: string }) => s.entityId === "demo-entity-1",
      ),
    );
    assert.equal(
      (
        await fetch(`${origin}/api/control/evidence/demo-lesson-source-1-0`, {
          headers: { cookie },
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await fetch(`${origin}/api/control/cron`, {
          method: "POST",
          headers: { Origin: origin, "Content-Type": "application/json" },
          body: "{}",
        })
      ).status,
      401,
    );
    const page = await fetch(origin);
    assert.equal(page.status, 200);
    const html = await page.text();
    const asset = html.match(
      /src="([^\"]+\/_next\/[^\"]+\.js[^\"]*)"|src="(\/_next\/[^\"]+\.js[^\"]*)"/,
    );
    if (asset) {
      assert.equal(
        (await fetch(new URL(asset[1] || asset[2], origin))).status,
        200,
        "Standalone assets must be served.",
      );
    }
    console.log(
      "Production smoke passed: startup, assets, authenticated session, disabled local bypass, scoped records, protected evidence and cron authorization.",
    );
  } finally {
    server.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      if (server.exitCode !== null) resolve();
      else {
        server.once("exit", () => resolve());
        setTimeout(() => {
          server.kill("SIGKILL");
          resolve();
        }, 3000).unref();
      }
    });
    rmSync(dir, { recursive: true, force: true });
  }
}
main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Production smoke failed.",
  );
  process.exitCode = 1;
});
