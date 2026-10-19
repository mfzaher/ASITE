import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

test("real Better Auth sign-in establishes a session; scoped memberships are enforced and revocation takes effect immediately", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ecc-auth-test-"));
  process.env.ECC_DATABASE_PATH = join(dir, "auth.sqlite");
  process.env.BETTER_AUTH_SECRET = randomBytes(48).toString("hex");
  process.env.BETTER_AUTH_URL = "http://localhost:3000";
  delete process.env.ECC_LOCAL_MODE;
  const { createWorkspaceAuth, getAuth, requireActor, sameOrigin } =
    await import("../src/lib/governance/auth");
  const { getMigrations } = await import("better-auth/db/migration");
  const { getStore } = await import("../src/lib/governance/store");
  const { may } = await import("../src/lib/governance/engine");
  const store = getStore();
  try {
    const provision = createWorkspaceAuth(true);
    await (await getMigrations(provision.options)).runMigrations();
    await provision.api.signUpEmail({
      body: {
        email: "reviewer@example.com",
        password: "Synthetic-Test-Password-Only-123",
        name: "Test reviewer",
      },
    });
    store.save("memberships", {
      id: "test-member",
      entityId: "entity-a",
      email: "reviewer@example.com",
      name: "Test reviewer",
      role: "reviewer",
      projectIds: ["project-a"],
      active: true,
    });
    const auth = await getAuth();
    const blocked = await auth.handler(
      new Request("http://localhost:3000/api/auth/sign-up/email", {
        method: "POST",
        headers: {
          Origin: "http://localhost:3000",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: "uninvited@example.com",
          password: "Synthetic-Test-Password-Only-123",
          name: "Uninvited",
        }),
      }),
    );
    assert.notEqual(
      blocked.status,
      200,
      "Public self-registration must be disabled.",
    );
    const login = await auth.handler(
      new Request("http://localhost:3000/api/auth/sign-in/email", {
        method: "POST",
        headers: {
          Origin: "http://localhost:3000",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: "reviewer@example.com",
          password: "Synthetic-Test-Password-Only-123",
        }),
      }),
    );
    assert.equal(login.status, 200);
    const setCookies = login.headers.getSetCookie();
    assert.ok(setCookies.some((c) => /httponly/i.test(c)));
    const headers = new Headers({
      cookie: setCookies.map((c) => c.split(";")[0]).join("; "),
    });
    const actor = await requireActor(headers);
    assert.equal(actor.email, "reviewer@example.com");
    assert.equal(
      may(actor, { entityId: "entity-a", projectId: "project-a" }, "reviewer"),
      true,
    );
    assert.equal(
      may(actor, { entityId: "entity-a", projectId: "project-secret" }),
      false,
    );
    assert.throws(
      () =>
        sameOrigin(
          new Request("http://localhost:3000/api/control/demo", {
            method: "POST",
            headers: { Origin: "https://foreign.example" },
          }),
        ),
      /same-origin/,
    );
    store.save("memberships", {
      ...store.get("memberships", "test-member")!,
      active: false,
    });
    await assert.rejects(requireActor(headers), /membership/);
    await assert.rejects(requireActor(new Headers()), /Sign in/);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
