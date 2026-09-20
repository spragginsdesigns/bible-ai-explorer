/**
 * Two rules that decide whether a number is true: what counts as internal
 * traffic, and what a failed route is allowed to say about itself.
 *
 * Both are pure, and both are the kind of thing that is only ever wrong in
 * production, where nobody is looking at it.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { routeShape, statusBucket } from "../src/lib/analytics/events.ts";
import { isInternalUserId } from "../src/lib/analytics/internal.ts";

const read = (relativePath) =>
	readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");

test("internal accounts are the allowlist and nothing else", () => {
	const allowlist = ["user_austin", "user_playreviewer"];
	assert.equal(isInternalUserId("user_playreviewer", allowlist), true);
	assert.equal(isInternalUserId("user_a_real_person", allowlist), false);
	// An unset allowlist must count everybody, never nobody: a real user
	// wrongly counted is a smaller lie than a real user quietly dropped.
	assert.equal(isInternalUserId("user_a_real_person", []), false);
});

test("routeShape keeps the endpoint and drops the id", () => {
	assert.equal(routeShape("/api/notes"), "/api/notes");
	assert.equal(routeShape("/api/verse-of-day/audio"), "/api/verse-of-day/audio");
	assert.equal(
		routeShape("/api/conversations/cmfk3x9q10001l504abcd1234/messages/cmfk3x9q10002l504efgh5678"),
		"/api/conversations/[id]/messages/[id]"
	);
	assert.equal(
		routeShape("/api/learn/0f8a1b2c-3d4e-5f60-7182-93a4b5c6d7e8/review"),
		"/api/learn/[id]/review"
	);
	assert.equal(routeShape("/api/reading-plans/12/days/3"), "/api/reading-plans/[id]/days/[id]");
});

test("routeShape takes an absolute URL, because the streaming client only has one", () => {
	assert.equal(routeShape("https://sureword.app/api/ask-question"), "/api/ask-question");
	// Without this the host became the first two path segments and every
	// failure grouped under "/https:/sureword.app/...".
	assert.doesNotMatch(routeShape("https://sureword.app/api/notes"), /sureword/);
});

test("routeShape never lets a query string through", () => {
	// /api/get-verse takes the reference as a query param, and which verse
	// somebody looked up is study content under the rule in events.ts.
	assert.equal(routeShape("/api/get-verse?ref=John+3:16"), "/api/get-verse");
	assert.equal(routeShape("/api/church/search?q=first+baptist"), "/api/church/search");
});

test("a shared link's id never survives, because it IS the credential", () => {
	// The id in /shared/<id> is what opens the shared answer for anyone
	// holding it (see the /shared/(.*) note in src/middleware.ts), so it must
	// not reach an analytics payload even when it does not look like an id.
	assert.equal(routeShape("/api/shared/abc"), "/api/shared/[id]");
	assert.equal(routeShape("/shared/plainword"), "/shared/[id]");
	assert.equal(routeShape("/api/shared/9f8a7b6c5d4e/comments"), "/api/shared/[id]");
});

test("statusBucket separates being logged out from the server being broken", () => {
	assert.equal(statusBucket(401), "auth");
	assert.equal(statusBucket(403), "auth");
	assert.equal(statusBucket(429), "rate_limited");
	assert.equal(statusBucket(500), "server");
	assert.equal(statusBucket(503), "server");
	assert.equal(statusBucket(404), "client");
	assert.equal(statusBucket(undefined), "none");
});

test("the Android copy of routeShape agrees with this one", () => {
	// The two are mirrored by hand across the workspace boundary, the same way
	// the event catalog is. A drift here means the same failing endpoint shows
	// up as two different rows depending on which half reported it.
	const mobile = read("../mobile/src/lib/analytics.ts");
	for (const fragment of [
		'const sharedAt = segments.indexOf("shared");',
		'segments.splice(sharedAt + 1, segments.length, "[id]");',
		"segment.length >= 12 && /\\d/.test(segment)",
	]) {
		assert.ok(
			mobile.includes(fragment),
			`mobile routeShape has drifted from the server copy: missing ${fragment}`
		);
	}
});
