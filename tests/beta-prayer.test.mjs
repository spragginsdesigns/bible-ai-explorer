/**
 * Prayer & Testimony (LC-17723, docs/beta/prayer.md): what a founder may
 * write into a living prayer entry, the confirmed-outcome rule, reminders,
 * the testimony timeline's order and months, and the privacy contract on
 * what the module writes and reads.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
	PRAYER_ENTRY_TITLE,
	PRAYER_REQUEST_MAX,
	PRAYER_UPDATE_MAX,
	PRAYER_WORDS_MAX,
	buildTimeline,
	checkOutcome,
	checkRemindOn,
	checkUpdateText,
	dayIn,
	isReminderDue,
	monthLabel,
	readPrayerEntry,
} from "../src/lib/beta/prayer/prayer-rules.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(repoRoot, path), "utf8");
const filesUnder = (dir) =>
	readdirSync(join(repoRoot, dir)).flatMap((name) => {
		const path = join(dir, name);
		return statSync(join(repoRoot, path)).isDirectory() ? filesUnder(path) : [path];
	});

test("an update is written text, trimmed, within its limit", () => {
	assert.deepEqual(checkUpdateText("  Mom called today.  "), { ok: true, value: "Mom called today." });
	assert.equal(checkUpdateText("   ").ok, false);
	assert.equal(checkUpdateText(undefined).ok, false);
	assert.equal(checkUpdateText(42).ok, false);
	assert.equal(checkUpdateText("x".repeat(PRAYER_UPDATE_MAX)).ok, true);
	assert.equal(checkUpdateText("x".repeat(PRAYER_UPDATE_MAX + 1)).ok, false);
});

test("an outcome needs the founder's confirmation and their own words", () => {
	const good = { kind: "answered", words: "The surgery went well.", reflection: " He was faithful. ", confirmed: true };
	assert.deepEqual(checkOutcome(good), { ok: true, value: { kind: "answered", words: "The surgery went well.", reflection: "He was faithful." } });
	assert.equal(checkOutcome({ ...good, confirmed: undefined }).ok, false, "not confirmed");
	assert.equal(checkOutcome({ ...good, confirmed: "true" }).ok, false, "confirmed must be exactly true");
	assert.equal(checkOutcome({ ...good, words: "  " }).ok, false, "no words");
	assert.equal(checkOutcome({ ...good, words: undefined }).ok, false, "no words");
	assert.equal(checkOutcome({ ...good, kind: "open" }).ok, false, "not an outcome");
	assert.equal(checkOutcome({ ...good, kind: "toString" }).ok, false);
	assert.equal(checkOutcome({ ...good, words: "x".repeat(PRAYER_WORDS_MAX + 1) }).ok, false);
	assert.deepEqual(checkOutcome({ ...good, kind: "closed", reflection: "" }), { ok: true, value: { kind: "closed", words: "The surgery went well.", reflection: null } });
});

test("a reminder is a real day from today to about two years ahead, or cleared", () => {
	const today = "2026-10-27";
	assert.deepEqual(checkRemindOn("2026-10-27", today), { ok: true, value: "2026-10-27" });
	assert.deepEqual(checkRemindOn("2027-01-05", today), { ok: true, value: "2027-01-05" });
	assert.deepEqual(checkRemindOn(null, today), { ok: true, value: null });
	assert.deepEqual(checkRemindOn("", today), { ok: true, value: null });
	assert.equal(checkRemindOn("2026-10-26", today).ok, false, "yesterday");
	assert.equal(checkRemindOn("2026-02-30", today).ok, false, "not a real day");
	assert.equal(checkRemindOn("2029-01-01", today).ok, false, "too far");
	assert.equal(checkRemindOn("next week", today).ok, false);
	assert.equal(checkRemindOn(20261101, today).ok, false);
	assert.equal(isReminderDue("2026-10-27", today, true), true);
	assert.equal(isReminderDue("2026-10-20", today, true), true);
	assert.equal(isReminderDue("2026-10-28", today, true), false);
	assert.equal(isReminderDue("2026-10-20", today, false), false, "an answered prayer is never due");
	assert.equal(isReminderDue(null, today, true), false);
});

test("a stored entry is read tolerantly and never trusted for shape", () => {
	assert.equal(readPrayerEntry(null), null);
	assert.equal(readPrayerEntry({ request: "x" }), null, "no memoryId");
	const entry = readPrayerEntry({
		memoryId: "m1",
		request: "Healing for Dad",
		askedAt: "2026-01-04T10:00:00.000Z",
		updates: [{ id: "u1", at: "2026-02-01T10:00:00.000Z", text: "Scan is clear" }, { id: 3 }, "junk"],
		passages: ["James 5:15", 7],
		remindOn: "tomorrow",
		outcome: { kind: "toString", at: "2026-03-01T10:00:00.000Z", words: "x" },
	});
	assert.equal(entry.private, true);
	assert.deepEqual(entry.updates, [{ id: "u1", at: "2026-02-01T10:00:00.000Z", text: "Scan is clear" }]);
	assert.deepEqual(entry.passages, ["James 5:15"]);
	assert.equal(entry.remindOn, null);
	assert.equal(entry.outcome, null);
});

test("the testimony timeline is oldest first, grouped by month on the founder's calendar", () => {
	const months = buildTimeline(
		[
			{
				memoryId: "b",
				request: "A job for Sam",
				askedAt: "2026-03-10T15:00:00.000Z",
				updates: [],
				passages: [],
				outcome: { kind: "answered", at: "2026-05-02T15:00:00.000Z", words: "Sam starts Monday.", reflection: "Wait on the LORD." },
			},
			{
				memoryId: "a",
				request: "Healing for Dad",
				askedAt: "2026-01-04T10:00:00.000Z",
				updates: [{ id: "u1", at: "2026-03-20T10:00:00.000Z", text: "Scan is clear" }],
				passages: ["James 5:15"],
				outcome: null,
			},
		],
		"America/New_York",
	);
	assert.deepEqual(months.map((month) => month.month), ["2026-01", "2026-03", "2026-05"]);
	assert.equal(months[0].label, "January 2026");
	assert.deepEqual(months[0].events.map((event) => [event.kind, event.request, event.passages]), [["asked", "Healing for Dad", ["James 5:15"]]]);
	assert.deepEqual(months[1].events.map((event) => [event.kind, event.request, event.text]), [
		["asked", "A job for Sam", null],
		["update", "Healing for Dad", "Scan is clear"],
	]);
	const outcome = months[2].events[0];
	assert.equal(outcome.kind, "outcome");
	assert.equal(outcome.outcomeKind, "answered");
	assert.equal(outcome.text, "Sam starts Monday.");
	assert.equal(outcome.reflection, "Wait on the LORD.");
	assert.deepEqual(buildTimeline([], "UTC"), []);
});

test("an event's month is the founder's local day, not UTC", () => {
	// 03:30 UTC on Nov 1 is still Oct 31 in Los Angeles.
	assert.equal(dayIn("2026-11-01T03:30:00.000Z", "America/Los_Angeles"), "2026-10-31");
	const [month] = buildTimeline([{ memoryId: "a", request: "r", askedAt: "2026-11-01T03:30:00.000Z", updates: [], passages: [], outcome: null }], "America/Los_Angeles");
	assert.equal(month.month, "2026-10");
	assert.equal(monthLabel("2026-10"), "October 2026");
});

test("the timeline never counts or scores", () => {
	// Code only: the comments say "never counts, scores or judges".
	const code = (path) => read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
	const source = code("src/components/beta/prayer/TestimonyTimeline.tsx") + code("src/lib/beta/prayer/prayer-rules.ts");
	assert.doesNotMatch(source, /streak|score|percent|\d+ answered|answered count/i);
});

test("a request's limit matches the prayer list's own", () => {
	assert.match(read("src/lib/memory.ts"), new RegExp(`MAX_MEMORY_CONTENT_LENGTH = ${PRAYER_REQUEST_MAX};`));
});

test("privacy: words live only in a private item's data, nothing reaches an AI, and the request stays on the prayer list", () => {
	const server = read("src/lib/beta/prayer/prayer.ts");
	assert.match(server, /PRAYER_ENTRY_TITLE/);
	assert.equal(PRAYER_ENTRY_TITLE, "Prayer request");
	assert.doesNotMatch(server, /body:/, "no searchable body");
	assert.match(read("src/lib/beta/prayer/prayer-rules.ts"), /private: true;/);
	// The prayer list row is read only as the caller's own, by id and category.
	for (const match of server.matchAll(/prisma\.userMemory\.\w+\(\{ where: \{([^}]*)\}/g)) {
		assert.match(match[1], /userId/, "every prayer list read and write is scoped to the caller");
		assert.match(match[1], /category: "prayer"/, "only prayer requests");
	}
	assert.doesNotMatch(server, /userMemory\.(create|delete)/, "never a second prayer store, never deletes a request");
	for (const file of [...filesUnder("src/lib/beta/prayer"), ...filesUnder("src/components/beta/prayer"), ...filesUnder("src/app/api/beta/prayer")]) {
		const source = read(file);
		assert.doesNotMatch(source, /from "@\/lib\/ai|from "ai"|@ai-sdk|openai|scripture-search|note-embeddings|generateText/, `${file} must not reach an AI or embeddings`);
	}
	// Sharing is the Groups prayer circle's own copy route, after a confirm step.
	const card = read("src/components/beta/prayer/PrayerRequestCard.tsx");
	assert.match(read("src/components/beta/prayer/prayerApi.ts"), /\/api\/beta\/groups\/\$\{encodeURIComponent\(groupId\)\}\/posts`, \{ kind: "prayer", memoryId \}/);
	assert.match(card, /Share a copy/);
	assert.match(card, /confirmed: true|recordOutcome/);
});
