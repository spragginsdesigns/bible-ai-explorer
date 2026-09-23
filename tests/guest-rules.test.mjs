/* "Try before you sign up" and "Show in search" (docs/FEATURES.md).
 *
 * The quota and id rules are pure, so they are tested directly. What is not
 * pure (which routes are public, where a guest's history comes from, what
 * makes a shared answer indexable) is pinned as source contracts, because
 * each one fails silently: a claim route exposed signed out, an assistant
 * turn a caller can forge, or a private question published to search.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
	DEFAULT_GUEST_DAILY_CAP,
	GUEST_ANSWERS_PER_DAY,
	MAX_GUEST_QUESTION_LENGTH,
	createGuestId,
	guestConversationTitle,
	guestDailyCap,
	guestIpHash,
	guestQuotaDecision,
	isGuestId,
	normalizeGuestQuestion,
} from "../src/lib/guest-rules.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => readFileSync(join(root, relative), "utf8");

test("guest ids are random, cookie-safe, and validated before any query", () => {
	const a = createGuestId();
	const b = createGuestId();
	assert.notEqual(a, b);
	assert.equal(isGuestId(a), true);
	assert.equal(isGuestId("../../etc/passwd"), false);
	assert.equal(isGuestId(""), false);
	assert.equal(isGuestId(undefined), false);
	assert.equal(isGuestId(`${a};Path=/`), false);
});

test("GUEST_DAILY_CAP parses to a non-negative integer, 0 is the kill switch", () => {
	assert.equal(guestDailyCap(undefined), DEFAULT_GUEST_DAILY_CAP);
	assert.equal(guestDailyCap(""), DEFAULT_GUEST_DAILY_CAP);
	assert.equal(guestDailyCap("0"), 0);
	assert.equal(guestDailyCap("40"), 40);
	assert.equal(guestDailyCap("-3"), DEFAULT_GUEST_DAILY_CAP);
	assert.equal(guestDailyCap("lots"), DEFAULT_GUEST_DAILY_CAP);
	assert.equal(guestDailyCap("2.5"), DEFAULT_GUEST_DAILY_CAP);
});

test("questions are trimmed, bounded, and refused when empty", () => {
	assert.equal(normalizeGuestQuestion("  What is grace?  "), "What is grace?");
	assert.equal(normalizeGuestQuestion("a\r\nb"), "a\nb");
	assert.equal(normalizeGuestQuestion("   "), null);
	assert.equal(normalizeGuestQuestion(42), null);
	assert.equal(normalizeGuestQuestion("x".repeat(MAX_GUEST_QUESTION_LENGTH)).length, MAX_GUEST_QUESTION_LENGTH);
	assert.equal(normalizeGuestQuestion("x".repeat(MAX_GUEST_QUESTION_LENGTH + 1)), null);
});

test("the address is keyed, stable per secret, and never the address itself", () => {
	const one = guestIpHash("203.0.113.9", "secret-a");
	assert.equal(one, guestIpHash("203.0.113.9", "secret-a"));
	assert.notEqual(one, guestIpHash("203.0.113.9", "secret-b"));
	assert.notEqual(one, guestIpHash("203.0.113.10", "secret-a"));
	assert.equal(one.includes("203.0.113.9"), false);
	assert.match(one, /^[0-9a-f]{64}$/);
});

test("counts include the reserved row: the third answer is allowed, the fourth is not", () => {
	const cap = 150;
	assert.deepEqual(guestQuotaDecision({ guest: 1, address: 1, global: 1, cap }), {
		allowed: true,
		reason: null,
		remaining: GUEST_ANSWERS_PER_DAY - 1,
	});
	assert.deepEqual(guestQuotaDecision({ guest: 3, address: 3, global: 9, cap }), {
		allowed: true,
		reason: null,
		remaining: 0,
	});
	assert.equal(guestQuotaDecision({ guest: 4, address: 4, global: 9, cap }).reason, "guest");
});

test("a cleared cookie on the same address is still held by the address ceiling", () => {
	const decision = guestQuotaDecision({ guest: 1, address: 4, global: 9, cap: 150 });
	assert.equal(decision.allowed, false);
	assert.equal(decision.reason, "address");
});

test("remaining is the tighter of the two ceilings", () => {
	assert.equal(guestQuotaDecision({ guest: 1, address: 2, global: 5, cap: 150 }).remaining, 1);
});

test("the global ceiling wins over everything, and a zero cap refuses outright", () => {
	assert.equal(guestQuotaDecision({ guest: 1, address: 1, global: 151, cap: 150 }).reason, "global");
	assert.equal(guestQuotaDecision({ guest: 1, address: 1, global: 150, cap: 150 }).allowed, true);
	assert.equal(guestQuotaDecision({ guest: 1, address: 1, global: 1, cap: 0 }).reason, "global");
});

test("the saved conversation is titled by the first question, on one line", () => {
	assert.equal(guestConversationTitle("What is\ngrace?"), "What is grace?");
	assert.equal(guestConversationTitle(""), "New Conversation");
	const long = guestConversationTitle("word ".repeat(40));
	assert.ok(long.length <= 60, `title is ${long.length} characters`);
	assert.ok(long.endsWith("…"));
});

// ---------------------------------------------------------------------------
// Route contracts
// ---------------------------------------------------------------------------

test("only the ask route is public; claiming stays behind the session", () => {
	const source = read("src/middleware.ts");
	assert.equal(source.includes('"/api/guest/ask"'), true, "guests cannot ask");
	for (const pattern of ['"/api/guest(.*)"', '"/api/guest/(.*)"', '"/api/guest/claim"']) {
		assert.equal(source.includes(pattern), false, `${pattern} would expose the claim route signed out`);
	}
});

test("the ask route reserves before counting and builds history from stored turns only", () => {
	const source = read("src/app/api/guest/ask/route.ts");
	const reserve = source.indexOf("prisma.guestTurn.create(");
	const count = source.indexOf("prisma.guestTurn.count(");
	assert.ok(reserve > 0 && count > reserve, "the row must be written before the ceilings are counted");
	assert.equal(/body\??\.messages/.test(source), false, "history must never come from the request body");
	assert.match(source, /checkBotId\(\)/, "BotID is not checked");
	assert.match(source, /GUEST_TOOL_NAMES = \["searchScripture", "findVerses", "getPassage", "getCrossReferences"\]/);
});

test("the claim route reads the guest id from the httpOnly cookie, not the body", () => {
	const source = read("src/app/api/guest/claim/route.ts");
	assert.match(source, /jar\.get\(GUEST_COOKIE\)/);
	assert.equal(/req\.json\(\)/.test(source), false, "a claim must not accept a guest id from the caller");
	assert.match(source, /getAuthUser\(\)/);
});

test("only listed, unrevoked shares are indexable or in the sitemap", () => {
	const page = read("src/app/shared/[id]/page.tsx");
	assert.match(page, /robots: \{ index: share\.listedAt !== null \}/);
	assert.match(page, /revokedAt: null/);
	const sitemap = read("src/app/sitemap.ts");
	assert.match(sitemap, /where: \{ listedAt: \{ not: null \}, revokedAt: null \}/);
});

test("revoking a share also unlists it", () => {
	const source = read("src/app/api/shared/[id]/route.ts");
	assert.match(source, /data: \{ revokedAt: new Date\(\), listedAt: null \}/);
	assert.match(source, /body\.listed && share\.revokedAt/);
});

test("robots.txt lets crawlers fetch /shared/ so they can see each page's own noindex", () => {
	const source = read("src/app/robots.ts");
	assert.equal(source.includes('"/shared/"'), false);
});
