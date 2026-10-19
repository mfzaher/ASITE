import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { resolve } from "node:path";

async function main() {
  const emailArg = process.argv.indexOf("--email"),
    email =
      emailArg >= 0 ? process.argv[emailArg + 1]?.toLowerCase() : undefined;
  if (
    !email ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    !process.argv.includes("--password-stdin")
  )
    throw new Error(
      "Usage: npm run setup -- --email owner@example.com --password-stdin (supply a 12+ character password on stdin).",
    );
  const password = readFileSync(0, "utf8").replace(/[\r\n]+$/, "");
  if (password.length < 12 || password.length > 200)
    throw new Error("Use a password of 12–200 characters.");
  const path = resolve(".env.local");
  let content = existsSync(path) ? readFileSync(path, "utf8") : "";
  for (const [name, value] of Object.entries({
    BETTER_AUTH_SECRET: randomBytes(48).toString("hex"),
    SESSION_SECRET: randomBytes(48).toString("hex"),
    BETTER_AUTH_URL: "http://localhost:3000",
  })) {
    const match = content.match(new RegExp(`^${name}=(.*)$`, "m")),
      existing = match?.[1].trim().replace(/^['"]|['"]$/g, "");
    const selected = process.env[name] || existing || value;
    if (!match) content += `\n${name}=${selected}\n`;
    else if (!existing)
      content = content.replace(
        new RegExp(`^${name}=.*$`, "m"),
        `${name}=${selected}`,
      );
    process.env[name] = selected;
  }
  writeFileSync(path, content, { mode: 0o600 });
  const { createWorkspaceAuth } = await import("../src/lib/governance/auth");
  const { getMigrations } = await import("better-auth/db/migration");
  const { getStore } = await import("../src/lib/governance/store");
  const store = getStore(),
    auth = createWorkspaceAuth(true);
  await (await getMigrations(auth.options)).runMigrations();
  if (store.db.prepare('SELECT id FROM "user" WHERE lower(email)=?').get(email))
    throw new Error(
      "This account already exists; its password was not changed.",
    );
  const result = await auth.api.signUpEmail({
    body: { email, password, name: email.split("@")[0] },
  });
  const first = store.all("memberships").length === 0;
  if (first)
    store.save("memberships", {
      id: randomUUID(),
      entityId: "*",
      email,
      name: result.user.name,
      role: "admin",
      projectIds: ["*"],
    });
  console.log(
    first
      ? "Workspace owner created. Start the app and sign in with the supplied email/password."
      : "Account created. An existing administrator must grant entity/project membership before access is available.",
  );
  store.close();
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Setup failed.");
  process.exitCode = 1;
});
