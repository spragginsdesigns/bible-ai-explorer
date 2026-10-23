/**
 * Server analytics must never sit in front of a response or leak a slow send
 * into a later request (src/lib/analytics/server.ts, "Serverless flushing").
 * Source pins, because the module needs posthog-node and a request context to
 * run, and what matters here is how it is configured and called.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const server = readFileSync("src/lib/analytics/server.ts", "utf8");

test("PostHog sends time out fast and retry at most once", () => {
	assert.match(server, /requestTimeout: REQUEST_TIMEOUT_MS/);
	assert.match(server, /fetchRetryCount: RETRY_COUNT/);
	assert.match(server, /fetchRetryDelay: RETRY_DELAY_MS/);
	assert.equal(Number(server.match(/const REQUEST_TIMEOUT_MS = (\d+);/)[1]) <= 3000, true);
	assert.equal(Number(server.match(/const RETRY_COUNT = (\d+);/)[1]) <= 1, true);
});

test("every capture and identify registers its own after-response flush", () => {
	assert.match(server, /import \{ waitUntil \} from "@vercel\/functions";/);
	assert.match(server, /waitUntil\(flushAnalytics\(DEFERRED_FLUSH_TIMEOUT_MS\)\)/);
	assert.equal(server.match(/flushAfterResponse\(\);/g)?.length, 2);
});

function sourceFiles(dir) {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) return sourceFiles(path);
		return /\.tsx?$/.test(name) ? [path] : [];
	});
}

test("no route holds its response open on an analytics flush", () => {
	// Billing is owned by its own lane; its two awaited flushes are known.
	const allowed = new Set([
		join("src", "app", "api", "billing", "checkout", "route.ts"),
		join("src", "app", "api", "webhooks", "stripe", "route.ts"),
	]);
	const offenders = [...sourceFiles(join("src", "app")), ...sourceFiles(join("src", "lib"))]
		.filter((path) => !allowed.has(path))
		.filter((path) => /await flushAnalytics\(/.test(readFileSync(path, "utf8")));
	assert.deepEqual(offenders, []);
});
