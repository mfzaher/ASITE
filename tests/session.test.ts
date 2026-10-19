import test from "node:test";
import assert from "node:assert/strict";
import { sealSession, openSession } from "../src/lib/session";

test("session encrypts credentials and rejects modified or expired tokens", () => {
  const oldSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "test-only-session-secret-with-32-characters-minimum";
  try {
    const session = {accessToken: "test-asite-token", region: "uae" as const, expiresAt: Date.now() + 60000};
    const sealed = sealSession(session);
    assert.ok(!sealed.includes(session.accessToken));
    assert.deepEqual(openSession(sealed), session);
    const modified = Buffer.from(sealed, "base64url");
    modified[modified.length - 1] ^= 1;
    assert.equal(openSession(modified.toString("base64url")), null);
    assert.equal(openSession(sealSession({...session, expiresAt: Date.now() - 1})), null);
    assert.equal(openSession("invalid"), null);
    process.env.SESSION_SECRET = "short";
    assert.throws(() => sealSession(session), /SESSION_SECRET/);
  } finally {
    if (oldSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = oldSecret;
  }
});
