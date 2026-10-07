/**
 * The owner's review queue at /admin/feedback (docs/FEATURES.md, "Reviewing
 * reports"). The access rule and the query shapes are pure functions in
 * src/lib/admin/feedback-review-rules.ts; the route contracts (404 before any
 * read, noindex, not in the sitemap) are checked against the source, the same
 * way tests/shared-answer.test.mjs checks the middleware.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { parseUserIdAllowlist } from "../src/lib/entitlements-rules.ts";
import {
	DEFAULT_REVIEW_FILTERS,
	REVIEW_MAX_PAGE,
	REVIEW_PAGE_SIZE,
	adminAccessStatus,
	answerRatingWhere,
	feedbackMessageWhere,
	isAdminUserId,
	modelIdFromMetadata,
	parseMarkReviewed,
	parseReviewFilters,
	pickReviewPage,
	previousUserTurnId,
	reviewFetchDepth,
	reviewKindsFor,
	reviewQueryString,
	reviewWindowStart,
} from "../src/lib/admin/feedback-review-rules.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFileSync(join(repoRoot, relativePath), "utf8");

const NOW = new Date("2026-10-07T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Access
// ---------------------------------------------------------------------------

test("ADMIN_USER_IDS parses with the shared allowlist parser", () => {
	assert.deepEqual(parseUserIdAllowlist(" user_a , ,user_b,"), ["user_a", "user_b"]);
	assert.deepEqual(parseUserIdAllowlist(undefined), []);
	assert.deepEqual(parseUserIdAllowlist(""), []);
});

test("only an allowlisted id is an admin", () => {
	const allowlist = parseUserIdAllowlist("user_owner,user_second");
	assert.equal(isAdminUserId("user_owner", allowlist), true);
	assert.equal(isAdminUserId("user_second", allowlist), true);
	assert.equal(isAdminUserId("user_stranger", allowlist), false);
	assert.equal(isAdminUserId("user_own", allowlist), false, "a prefix is not a match");
	assert.equal(isAdminUserId("USER_OWNER", allowlist), false, "ids are case-sensitive");
});

test("signed out, an empty id, or an unset allowlist is never admin", () => {
	const allowlist = parseUserIdAllowlist("user_owner");
	assert.equal(isAdminUserId(null, allowlist), false);
	assert.equal(isAdminUserId(undefined, allowlist), false);
	assert.equal(isAdminUserId("", allowlist), false);
	assert.equal(isAdminUserId("   ", allowlist), false);
	assert.equal(isAdminUserId("user_owner", parseUserIdAllowlist(undefined)), false);
	assert.equal(isAdminUserId("", parseUserIdAllowlist(",,")), false);
});

test("non-admins get 404, not 403 or 401", () => {
	const allowlist = parseUserIdAllowlist("user_owner");
	assert.equal(adminAccessStatus("user_owner", allowlist), 200);
	assert.equal(adminAccessStatus("user_stranger", allowlist), 404);
	assert.equal(adminAccessStatus(null, allowlist), 404);
	assert.equal(adminAccessStatus("user_owner", []), 404);
});

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

test("filters default to everything, 30 days, unreviewed, page 1", () => {
	assert.deepEqual(parseReviewFilters(new URLSearchParams()), DEFAULT_REVIEW_FILTERS);
	assert.deepEqual(parseReviewFilters({}), {
		type: "all",
		days: 30,
		unreviewedOnly: true,
		page: 1,
	});
});

test("filters read every supported value", () => {
	assert.deepEqual(parseReviewFilters(new URLSearchParams("type=rating&days=7&unreviewed=0&page=3")), {
		type: "rating",
		days: 7,
		unreviewedOnly: false,
		page: 3,
	});
	assert.deepEqual(parseReviewFilters({ type: "message", days: "90", unreviewed: "1", page: ["2", "9"] }), {
		type: "message",
		days: 90,
		unreviewedOnly: true,
		page: 2,
	});
});

test("unknown filter values fall back instead of erroring", () => {
	const filters = parseReviewFilters(new URLSearchParams("type=users&days=365&unreviewed=maybe&page=-4"));
	assert.deepEqual(filters, DEFAULT_REVIEW_FILTERS);
	assert.equal(parseReviewFilters({ page: "1e3" }).page, 1);
	assert.equal(parseReviewFilters({ page: "0" }).page, 1);
	assert.equal(parseReviewFilters({ page: "99999" }).page, REVIEW_MAX_PAGE);
});

test("the query string round-trips and omits defaults", () => {
	assert.equal(reviewQueryString(DEFAULT_REVIEW_FILTERS), "");
	const filters = { type: "message", days: 90, unreviewedOnly: false, page: 4 };
	const query = reviewQueryString(filters);
	assert.equal(query, "?type=message&days=90&unreviewed=0&page=4");
	assert.deepEqual(parseReviewFilters(new URLSearchParams(query.slice(1))), filters);
});

// ---------------------------------------------------------------------------
// Query builder
// ---------------------------------------------------------------------------

test("the window starts N days before now", () => {
	assert.equal(reviewWindowStart(7, NOW).getTime(), NOW.getTime() - 7 * DAY);
	assert.equal(reviewWindowStart(90, NOW).getTime(), NOW.getTime() - 90 * DAY);
});

test("answer ratings are thumbs-down assistant rows in the window", () => {
	assert.deepEqual(answerRatingWhere({ ...DEFAULT_REVIEW_FILTERS, days: 7 }, NOW), {
		role: "assistant",
		feedback: "down",
		feedbackAt: { gte: new Date(NOW.getTime() - 7 * DAY) },
		feedbackReviewedAt: null,
	});
	const all = answerRatingWhere({ ...DEFAULT_REVIEW_FILTERS, unreviewedOnly: false }, NOW);
	assert.equal("feedbackReviewedAt" in all, false, "include-reviewed must not filter on the mark");
	assert.equal(all.feedback, "down", "a thumbs up is never a report");
});

test("feedback messages are Feedback rows in the window", () => {
	assert.deepEqual(feedbackMessageWhere({ ...DEFAULT_REVIEW_FILTERS, days: 90 }, NOW), {
		createdAt: { gte: new Date(NOW.getTime() - 90 * DAY) },
		reviewedAt: null,
	});
	assert.deepEqual(feedbackMessageWhere({ ...DEFAULT_REVIEW_FILTERS, unreviewedOnly: false }, NOW), {
		createdAt: { gte: new Date(NOW.getTime() - 30 * DAY) },
	});
});

test("the type filter picks which lists are read", () => {
	assert.deepEqual(reviewKindsFor(DEFAULT_REVIEW_FILTERS), ["rating", "message"]);
	assert.deepEqual(reviewKindsFor({ ...DEFAULT_REVIEW_FILTERS, type: "rating" }), ["rating"]);
	assert.deepEqual(reviewKindsFor({ ...DEFAULT_REVIEW_FILTERS, type: "message" }), ["message"]);
});

test("each list is read deep enough to fill the page and see the next", () => {
	assert.equal(reviewFetchDepth(DEFAULT_REVIEW_FILTERS), REVIEW_PAGE_SIZE + 1);
	assert.equal(reviewFetchDepth({ ...DEFAULT_REVIEW_FILTERS, page: 3 }), 3 * REVIEW_PAGE_SIZE + 1);
});

function stubs(kind, count, startMs, stepMs) {
	return Array.from({ length: count }, (_, index) => ({
		kind,
		id: `${kind}-${String(index).padStart(3, "0")}`,
		at: new Date(startMs - index * stepMs),
	}));
}

test("two lists merge newest first into pages of 50", () => {
	const ratings = stubs("rating", 60, NOW.getTime(), 2000);
	const messages = stubs("message", 60, NOW.getTime() - 1000, 2000);
	const first = pickReviewPage([ratings, messages], DEFAULT_REVIEW_FILTERS);
	assert.equal(first.items.length, REVIEW_PAGE_SIZE);
	assert.equal(first.hasMore, true);
	assert.equal(first.items[0].id, "rating-000");
	assert.equal(first.items[1].id, "message-000");
	for (let i = 1; i < first.items.length; i += 1) {
		assert.ok(first.items[i - 1].at >= first.items[i].at, "not newest first");
	}

	const third = pickReviewPage([ratings, messages], { ...DEFAULT_REVIEW_FILTERS, page: 3 });
	assert.equal(third.items.length, 20);
	assert.equal(third.hasMore, false);

	const seen = new Set();
	for (const page of [1, 2, 3]) {
		for (const item of pickReviewPage([ratings, messages], { ...DEFAULT_REVIEW_FILTERS, page }).items) {
			assert.equal(seen.has(item.id), false, `${item.id} appears on two pages`);
			seen.add(item.id);
		}
	}
	assert.equal(seen.size, 120);
});

test("equal timestamps tie-break on id so page boundaries are stable", () => {
	const at = new Date(NOW);
	const page = pickReviewPage(
		[[{ kind: "rating", id: "a", at }], [{ kind: "message", id: "b", at }]],
		DEFAULT_REVIEW_FILTERS
	);
	assert.deepEqual(page.items.map((item) => item.id), ["b", "a"]);
});

test("an exactly full page says there is no next page", () => {
	const page = pickReviewPage([stubs("rating", REVIEW_PAGE_SIZE, NOW.getTime(), 1000)], DEFAULT_REVIEW_FILTERS);
	assert.equal(page.items.length, REVIEW_PAGE_SIZE);
	assert.equal(page.hasMore, false);
});

test("the question is the nearest user turn before the answer", () => {
	const thread = [
		{ id: "u1", role: "user" },
		{ id: "a1", role: "assistant" },
		{ id: "u2", role: "user" },
		{ id: "a2", role: "assistant" },
		{ id: "a3", role: "assistant" },
	];
	assert.equal(previousUserTurnId(thread, "a1"), "u1");
	assert.equal(previousUserTurnId(thread, "a3"), "u2");
	assert.equal(previousUserTurnId([{ id: "a0", role: "assistant" }], "a0"), null);
	assert.equal(previousUserTurnId(thread, "missing"), null);
});

test("the model comes from metadata.modelId only", () => {
	assert.equal(modelIdFromMetadata({ modelId: "gpt-5.6-terra", parts: [] }), "gpt-5.6-terra");
	assert.equal(modelIdFromMetadata({ modelId: "" }), null);
	assert.equal(modelIdFromMetadata(null), null);
	assert.equal(modelIdFromMetadata([{ modelId: "x" }]), null);
});

test("the mark-reviewed body is validated", () => {
	assert.deepEqual(parseMarkReviewed({ kind: "rating", id: "msg_1" }), {
		ok: true,
		data: { kind: "rating", id: "msg_1", reviewed: true },
	});
	assert.deepEqual(parseMarkReviewed({ kind: "message", id: " fb_1 ", reviewed: false }), {
		ok: true,
		data: { kind: "message", id: "fb_1", reviewed: false },
	});
	for (const body of [null, [], "x", { kind: "user", id: "a" }, { kind: "rating" }, { kind: "rating", id: "" }, { kind: "rating", id: "a", reviewed: "yes" }, { kind: "rating", id: "x".repeat(65) }]) {
		assert.equal(parseMarkReviewed(body).ok, false, JSON.stringify(body));
	}
});

// ---------------------------------------------------------------------------
// Route contracts
// ---------------------------------------------------------------------------

test("the page 404s before it reads anything, and is noindex", () => {
	const source = read("src/app/admin/feedback/page.tsx");
	const gate = source.indexOf("if (!(await currentAdminUserId())) notFound();");
	const load = source.indexOf("await loadReviewPage(");
	assert.ok(gate > 0, "the page does not gate on ADMIN_USER_IDS with notFound()");
	assert.ok(load > gate, "the page loads data before the admin check");
	assert.match(source, /robots: \{ index: false, follow: false/);
	assert.equal(source.includes("forbidden()"), false, "a 403 would admit the page exists");
});

test("both API methods 404 before they read or write", () => {
	const source = read("src/app/api/admin/feedback/route.ts");
	for (const [method, work] of [
		["GET", "loadReviewPage("],
		["POST", "setReviewed("],
	]) {
		const start = source.indexOf(`export async function ${method}(`);
		assert.ok(start > 0, `${method} is missing`);
		const gate = source.indexOf("if (!(await currentAdminUserId())) return notFound();", start);
		const action = source.indexOf(work, start);
		assert.ok(gate > start && action > gate, `${method} does work before the admin check`);
	}
	assert.match(source, /status: 404/);
	assert.equal(/status: 40[13]\b/.test(source), false, "non-admins must get 404, not 401 or 403");
});

test("the gate reads ADMIN_USER_IDS through the shared parser", () => {
	const source = read("src/lib/admin/feedback-review.ts");
	assert.match(source, /parseUserIdAllowlist\(process\.env\.ADMIN_USER_IDS\)/);
	assert.equal(/email\s*:\s*row\./i.test(source), false, "no email may reach the page");
	assert.match(source, /wantsReply: Boolean\(row\.replyEmail\)/);
});

test("signed-out visitors reach the route's own 404, and the sitemap never lists it", () => {
	const middleware = read("src/middleware.ts");
	assert.equal(middleware.includes('"/admin(.*)"'), true);
	assert.equal(middleware.includes('"/api/admin(.*)"'), true);
	assert.equal(read("src/app/sitemap.ts").includes("/admin"), false);
	assert.equal(read("src/app/robots.ts").includes('"/admin'), false, "an allow rule would invite crawling");
});

test("re-rating an answer puts it back in the queue", () => {
	const source = read("src/app/api/conversations/[id]/messages/[messageId]/route.ts");
	assert.match(source, /feedback\.data && \{ feedbackReviewedAt: null \}/);
});
