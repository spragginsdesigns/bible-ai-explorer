/**
 * In-app feedback (docs/FEATURES.md, "Send feedback"): the validation rules as
 * pure functions, and the POST route's contract driven through a fake Prisma
 * so the content rule is proven rather than asserted in a comment.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { fileURLToPath } from "node:url";

const read = (relativePath) =>
	readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");

function loadModule(relativePath, exportNames, injected = {}) {
	const source = read(relativePath)
		.replace(/^import\s[^;]*?;\s*$/gm, "")
		.replace(/^export /gm, "");
	const names = Object.keys(injected);
	const factory = new Function(
		...names,
		`${stripTypeScriptTypes(source)}\nreturn { ${exportNames.join(", ")} };`
	);
	return factory(...names.map((name) => injected[name]));
}

const { parseFeedbackSubmission, FEEDBACK_CATEGORIES, MAX_FEEDBACK_MESSAGE_LENGTH } = loadModule(
	"../src/lib/feedback/in-app-feedback.ts",
	["parseFeedbackSubmission", "FEEDBACK_CATEGORIES", "MAX_FEEDBACK_MESSAGE_LENGTH"]
);

// -- the rules ---------------------------------------------------------------

test("every category is accepted and anything else is refused", () => {
	for (const { id } of FEEDBACK_CATEGORIES) {
		assert.equal(parseFeedbackSubmission({ category: id, message: "hi" }).ok, true);
	}
	for (const category of [undefined, null, "", "compliment", 1, ["bug"]]) {
		assert.equal(parseFeedbackSubmission({ category, message: "hi" }).ok, false);
	}
});

test("a message is trimmed, required, and capped", () => {
	assert.equal(
		parseFeedbackSubmission({ category: "bug", message: "  Listen never loads.  " }).data.message,
		"Listen never loads."
	);
	for (const message of ["", "   ", undefined, null, 42]) {
		assert.equal(parseFeedbackSubmission({ category: "bug", message }).ok, false);
	}
	assert.equal(
		parseFeedbackSubmission({ category: "bug", message: "x".repeat(MAX_FEEDBACK_MESSAGE_LENGTH) }).ok,
		true
	);
	assert.equal(
		parseFeedbackSubmission({
			category: "bug",
			message: "x".repeat(MAX_FEEDBACK_MESSAGE_LENGTH + 1),
		}).ok,
		false
	);
});

test("a reply address is optional, but an unreachable one is refused rather than dropped", () => {
	// Someone who asked for an answer and silently will not get one is the
	// worst outcome, so a malformed address is a 400 and not a null column.
	assert.equal(parseFeedbackSubmission({ category: "idea", message: "hi" }).data.replyEmail, null);
	assert.equal(
		parseFeedbackSubmission({ category: "idea", message: "hi", replyEmail: "  a@b.co " }).data
			.replyEmail,
		"a@b.co"
	);
	for (const replyEmail of ["not-an-address", "a@b", "a b@c.co", `${"x".repeat(250)}@b.co`]) {
		assert.equal(parseFeedbackSubmission({ category: "idea", message: "hi", replyEmail }).ok, false);
	}
});

test("an unreadable app version is dropped, never a reason to refuse the message", () => {
	const parsed = parseFeedbackSubmission({ category: "bug", message: "hi", appVersion: 17 });
	assert.equal(parsed.ok, true);
	assert.equal(parsed.data.appVersion, null);
	assert.equal(
		parseFeedbackSubmission({ category: "bug", message: "hi", appVersion: "1.71.0 (77)" }).data
			.appVersion,
		"1.71.0 (77)"
	);
});

// -- the route ---------------------------------------------------------------

const ROUTE = "../src/app/api/feedback/route.ts";

function feedbackRoute({ client = "android" } = {}) {
	const rows = [];
	const analytics = [];
	const NextResponse = {
		json: (body, init) => ({ status: init?.status ?? 200, body }),
	};
	const prisma = {
		feedback: {
			create: async (args) => {
				rows.push(args.data);
				return { id: "fb-1", createdAt: new Date("2026-09-19T23:00:00.000Z") };
			},
		},
	};
	const { POST } = loadModule(ROUTE, ["POST"], {
		NextResponse,
		prisma,
		getAuthUser: async () => "user_alice",
		createRateLimiter: () => ({ check: () => ({ allowed: true, retryAfterSeconds: 0 }) }),
		rateLimitKey: () => "key",
		parseFeedbackSubmission,
		captureServerEvent: (event) => analytics.push(event),
		flushAnalytics: async () => {},
		ANALYTICS_EVENTS: { feedbackSubmitted: "feedback_submitted" },
		platformFromHeaders: (headers) => headers.get("x-sureword-client") ?? "unknown",
		sizeBucket: () => "under_100",
	});
	return {
		rows,
		analytics,
		send: (body) =>
			POST({
				json: async () => body,
				headers: new Headers({ "x-sureword-client": client }),
			}),
	};
}

test("a submission is stored with the platform the request came from, not the one it claims", async () => {
	const route = feedbackRoute({ client: "android" });
	const response = await route.send({
		category: "bug",
		message: "Listen never loads.",
		platform: "web",
	});
	assert.equal(response.status, 200);
	assert.equal(route.rows.length, 1);
	assert.equal(route.rows[0].platform, "android");
	assert.equal(route.rows[0].message, "Listen never loads.");
	assert.equal(route.rows[0].userId, "user_alice");
});

test("the analytics event carries the category and never a word of the message", async () => {
	const route = feedbackRoute();
	await route.send({
		category: "praise",
		message: "My wife and I read the Daily Cross together every morning.",
		replyEmail: "reader@example.com",
	});
	assert.deepEqual(route.analytics, [
		{
			userId: "user_alice",
			event: "feedback_submitted",
			platform: "android",
			properties: {
				category: "praise",
				length: "under_100",
				wantsReply: true,
				appVersion: null,
			},
		},
	]);
	const reported = JSON.stringify(route.analytics);
	assert.ok(!reported.includes("wife"));
	assert.ok(!reported.includes("reader@example.com"));
});

test("an invalid submission is a 400 that never reaches the table", async () => {
	const route = feedbackRoute();
	const response = await route.send({ category: "bug", message: "   " });
	assert.equal(response.status, 400);
	assert.equal(route.rows.length, 0);
	assert.deepEqual(route.analytics, []);
});
