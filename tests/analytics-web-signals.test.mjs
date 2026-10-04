/**
 * The web client's analytics rules: no URL leaves the browser with a query
 * string, a failed request is named the way Android names it, and a Clerk
 * sign-in failure carries a code and a method and nothing that was typed.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
	classifyFetchRejection,
	clerkErrorCodeFrom,
	clerkSignInFailureFrom,
	createFailureThrottle,
	sameOriginApiPath,
	sanitizeAnalyticsPathname,
	sanitizeAnalyticsUrl,
	sanitizeOutgoingEvent,
	signInMethodFromStrategy,
} from "../src/lib/analytics/web-signals.ts";
import { entityRowMeta } from "../src/components/atlas/atlasView.ts";

const read = (relativePath) =>
	readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");

test("URLs lose their query string, fragment and shared-answer id", () => {
	assert.equal(
		sanitizeAnalyticsUrl("https://sureword.app/?prompt=What%20is%20grace&attachText=For%20God%20so"),
		"https://sureword.app/"
	);
	assert.equal(sanitizeAnalyticsUrl("https://sureword.app/bible/chapter?book=43&chapter=3#v16"), "https://sureword.app/bible/chapter");
	assert.equal(sanitizeAnalyticsUrl("https://sureword.app/shared/abc123secret?x=1"), "https://sureword.app/shared/[id]");
	assert.equal(sanitizeAnalyticsUrl("/notes?note=n1"), "/notes");
	assert.equal(sanitizeAnalyticsPathname("/shared/token"), "/shared/[id]");
	assert.equal(sanitizeAnalyticsPathname("/sermons"), "/sermons");
});

test("every URL-shaped property on an outgoing event is sanitized, not just $pageview", () => {
	const event = {
		event: "$pageleave",
		properties: {
			$current_url: "https://sureword.app/?prompt=secret",
			$referrer: "https://sureword.app/bible/chapter?book=1&chapter=1",
			$pathname: "/shared/tok",
			$session_entry_url: "https://sureword.app/?attachText=verse",
			title: "keep me",
			$set: { $current_url: "https://sureword.app/?prompt=x" },
		},
		$set_once: { $initial_current_url: "https://sureword.app/?prompt=first" },
	};
	const out = sanitizeOutgoingEvent(event);
	assert.equal(out.properties.$current_url, "https://sureword.app/");
	assert.equal(out.properties.$referrer, "https://sureword.app/bible/chapter");
	assert.equal(out.properties.$pathname, "/shared/[id]");
	assert.equal(out.properties.$session_entry_url, "https://sureword.app/");
	assert.equal(out.properties.title, "keep me");
	assert.equal(out.properties.$set.$current_url, "https://sureword.app/");
	assert.equal(out.$set_once.$initial_current_url, "https://sureword.app/");
	assert.equal(out.event, "$pageleave");
	assert.doesNotMatch(JSON.stringify(out), /secret|verse|prompt/);
	// The input is not mutated.
	assert.equal(event.properties.$current_url, "https://sureword.app/?prompt=secret");
});

test("fetch rejections: user aborts are not failures, timeouts and network errors are", () => {
	const named = (name) => Object.assign(new Error(name), { name });
	assert.equal(classifyFetchRejection(named("AbortError")), null);
	assert.equal(classifyFetchRejection(named("AbortError"), named("TimeoutError")), "timeout");
	assert.equal(classifyFetchRejection(named("TimeoutError")), "timeout");
	assert.equal(classifyFetchRejection(new TypeError("Failed to fetch")), "offline");
});

test("only same-origin /api/ calls are observed", () => {
	const origin = "https://sureword.app";
	assert.equal(sameOriginApiPath("https://sureword.app/api/notes/abc?x=1", origin), "/api/notes/abc");
	assert.equal(sameOriginApiPath("/api/sermon-studies", origin), "/api/sermon-studies");
	assert.equal(sameOriginApiPath("https://clerk.sureword.app/v1/client", origin), null);
	assert.equal(sameOriginApiPath("https://sureword.app/ingest/e", origin), null);
});

test("the failure throttle reports once per key per window", () => {
	const allow = createFailureThrottle(30_000);
	assert.equal(allow("/api/notes:offline", 0), true);
	assert.equal(allow("/api/notes:offline", 10_000), false);
	assert.equal(allow("/api/notes:http", 10_000), true);
	assert.equal(allow("/api/notes:offline", 30_000), true);
});

test("Clerk sign-in failures name the method and step, never the identifier", () => {
	const fapi = "https://clerk.sureword.app/v1/client/sign_ins";
	assert.deepEqual(clerkSignInFailureFrom(`${fapi}?__clerk_api_version=1`, "identifier=a%40b.com"), {
		method: "email",
		step: "lookup",
	});
	assert.deepEqual(clerkSignInFailureFrom(`${fapi}/sia_123/attempt_first_factor`, "strategy=password&password=hunter2"), {
		method: "password",
		step: "verify",
	});
	assert.deepEqual(clerkSignInFailureFrom(`${fapi}/sia_123/attempt_first_factor`, "strategy=email_code&code=123456"), {
		method: "email_code",
		step: "verify",
	});
	assert.deepEqual(clerkSignInFailureFrom(fapi, "strategy=oauth_google&redirect_url=x"), { method: "google", step: "lookup" });
	assert.equal(clerkSignInFailureFrom("https://clerk.sureword.app/v1/client/sessions/x/tokens", null), null);
	assert.equal(clerkErrorCodeFrom({ errors: [{ code: "form_password_incorrect", message: "typed text" }] }), "form_password_incorrect");
	assert.equal(clerkErrorCodeFrom(null), "unknown");
	assert.equal(signInMethodFromStrategy("oauth_google"), "google");
	assert.equal(signInMethodFromStrategy(null), null);
});

test("the SDK init registers the sanitizer and the sign-in page mounts its funnel", () => {
	assert.match(read("../src/instrumentation-client.ts"), /before_send:\s*\(event\)\s*=>\s*\(event \? sanitizeOutgoingEvent\(event\)/);
	const provider = read("../src/components/analytics/AnalyticsProvider.tsx");
	assert.doesNotMatch(provider, /useSearchParams/);
	assert.match(read("../src/app/sign-in/[[...sign-in]]/page.tsx"), /<SignInAnalytics \/>/);
	// Sign-in events may carry the method, the code and the step, nothing else.
	const signIn = read("../src/components/analytics/SignInAnalytics.tsx");
	assert.doesNotMatch(signIn, /\.identifier|emailAddress|\.message/);
});

test("Atlas directory rows show era, else modern region, after the kind", () => {
	assert.equal(entityRowMeta({ kind: "person", era: "Egypt & the Exodus", modernRegion: null }), "Person · Egypt & the Exodus");
	assert.equal(entityRowMeta({ kind: "place", era: null, modernRegion: "Israel" }), "Place · Israel");
	assert.equal(entityRowMeta({ kind: "place", era: null, modernRegion: null }), "Place");
});
