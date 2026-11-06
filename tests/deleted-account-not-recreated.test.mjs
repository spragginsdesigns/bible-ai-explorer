import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/lib/auth.ts", import.meta.url), "utf8");
const ensure = source.slice(source.indexOf("async function ensureUserRecord"));

test("a Clerk 404 during the account check answers 401 instead of creating the row", () => {
	// Found in the App Store 1.31.0 new-user pass: deleting the account and then
	// the app's sign-out DELETE /api/push-tokens re-created an empty User row.
	assert.match(source, /if \(isClerkUserGone\(error\)\) throw new ClerkUserGone\(\);/);
	const refuse = ensure.indexOf("instanceof ClerkUserGone");
	const create = ensure.indexOf("prisma.user.createMany");
	assert.ok(refuse > 0 && create > 0 && refuse < create, "the refusal must run before the row is created");
	assert.match(ensure.slice(refuse, create), /status: 401/);
});

test("only a Clerk 404 counts as a deleted user; other claim failures still never block sign-in", () => {
	assert.match(source, /e\.clerkError === true && e\.status === 404/);
	assert.match(source, /console\.error\("Legacy account claim failed:", error\);\n\t\treturn false;/);
});
