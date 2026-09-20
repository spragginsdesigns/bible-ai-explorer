/**
 * The analytics event catalog is shared vocabulary (docs/FEATURES.md, "What we
 * measure"). A name that drifts between the server and a client does not fail
 * anything: it quietly splits one funnel into two, and the second half looks
 * like a feature nobody uses.
 *
 * So the names are pinned here, and so is the content rule, by reading the
 * source rather than trusting the comment above it.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (relativePath) =>
	readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");

/** Pull `key: "value"` pairs out of an `as const` object literal. */
function eventMap(source, objectName) {
	const block = source.match(new RegExp(`${objectName}\\s*=\\s*\\{([\\s\\S]*?)\\}\\s*as const`));
	assert.ok(block, `${objectName} not found`);
	const names = {};
	for (const [, key, value] of block[1].matchAll(/(\w+):\s*"([^"]+)"/g)) names[key] = value;
	return names;
}

const serverSource = read("../src/lib/analytics/events.ts");
const mobileSource = read("../mobile/src/lib/analytics.ts");

const serverEvents = eventMap(serverSource, "ANALYTICS_EVENTS");
const mobileEvents = eventMap(mobileSource, "ANALYTICS_EVENTS");

test("the server catalog is not empty and every name is snake_case", () => {
	const names = Object.values(serverEvents);
	assert.ok(names.length >= 10, `expected a real catalog, got ${names.length}`);
	for (const name of names) {
		assert.match(name, /^[a-z][a-z0-9_]*$/, `${name} is not snake_case`);
	}
	assert.equal(new Set(names).size, names.length, "two keys share one event name");
});

test("every event Android sends exists in the server catalog, by key and by value", () => {
	for (const [key, value] of Object.entries(mobileEvents)) {
		assert.ok(key in serverEvents, `mobile sends ${key}, which the server catalog does not define`);
		assert.equal(
			value,
			serverEvents[key],
			`mobile sends "${value}" for ${key}; the server calls it "${serverEvents[key]}"`
		);
	}
});

test("neither client resets analytics on the bare signed-out state", () => {
	/*
	 * The regression this pins shut, measured on 2026-09-20: `reset()` was
	 * called whenever Clerk reported nobody signed in. Clerk reports exactly
	 * that for a beat on every cold start, and reset() mints a new anonymous
	 * id, so each launch's `Application Installed` and `Application Opened`
	 * landed on a person that nothing ever merged with. Six launches by two
	 * people (an emulator, Austin's phone and four Google Play review devices)
	 * were reported as six new users, and the web half broke the sign-up
	 * funnel the same way by resetting every signed-out visitor before they
	 * could convert.
	 *
	 * The fix is that a reset requires a PREVIOUS user: somebody was signed in,
	 * and now is not. Both clients hold that in a ref, so the test is that the
	 * ref exists and that reset is guarded by it.
	 */
	for (const [label, source] of [
		["web", read("../src/components/analytics/AnalyticsProvider.tsx")],
		["android", read("../mobile/app/_layout.tsx")],
	]) {
		assert.match(
			source,
			/previousUserId\s*=\s*useRef<string \| null>\(null\)/,
			`${label} lost the previous-user ref that tells a sign-out from being signed out`
		);
		assert.match(
			source,
			/if\s*\(previousUserId\.current\)\s*\{\s*(posthog\.reset|resetAnalytics)\(\)/,
			`${label} resets analytics without first checking that somebody was signed in`
		);
	}
});

test("the Android client does not store a profile for every anonymous launch", () => {
	// personProfiles defaults to 'always' in the React Native SDK, which stores
	// a person for every anonymous app open. Web has always been
	// identified_only; this is the line that makes the two agree.
	assert.match(mobileSource, /personProfiles:\s*"identified_only"/);
});

test("both clients keep autocapture and session replay off", () => {
	// Not style: autocapture records the text of whatever was clicked, and in
	// this app that text is a verse or somebody's saved question. Session
	// replay records the screen outright. The privacy page promises neither
	// happens, so turning either on has to break a test first.
	const web = read("../src/instrumentation-client.ts");
	assert.match(web, /autocapture:\s*false/);
	assert.match(web, /disable_session_recording:\s*true/);

	const mobileLayout = read("../mobile/app/_layout.tsx");
	assert.match(mobileLayout, /captureTouches:\s*false/);
	assert.doesNotMatch(mobileSource, /enableSessionReplay:\s*true/);
});
