import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
	AUDIO_ACTIVITY_WINDOW_MS,
	PUSH_ACTIVITY_WINDOW_MS,
	isActiveWithin,
	lastActivityByUser,
	splitByActivity,
} from "../src/lib/cron-audience.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const NOW = new Date("2026-09-12T15:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (days) => new Date(NOW.getTime() - days * DAY);

/** Rows shaped like the cron's grouped query: one per activity source per user. */
const FIXTURE_ROWS = [
	{ userId: "daily", lastActiveAt: daysAgo(40) }, // an old note edit
	{ userId: "daily", lastActiveAt: daysAgo(0.5) }, // a chat message this morning
	{ userId: "reader", lastActiveAt: daysAgo(12) }, // a ReadingEvent 12 days ago
	{ userId: "lapsed", lastActiveAt: daysAgo(45) },
	{ userId: "broken", lastActiveAt: null },
	{ userId: "broken", lastActiveAt: new Date(Number.NaN) },
];

test("windows are 30 days for the day and push, 7 for pre-made audio", () => {
	assert.equal(PUSH_ACTIVITY_WINDOW_MS, 30 * DAY);
	assert.equal(AUDIO_ACTIVITY_WINDOW_MS, 7 * DAY);
});

test("lastActivityByUser keeps the newest row per user and ignores empty dates", () => {
	const latest = lastActivityByUser(FIXTURE_ROWS);
	assert.equal(latest.get("daily")?.getTime(), daysAgo(0.5).getTime());
	assert.equal(latest.get("reader")?.getTime(), daysAgo(12).getTime());
	assert.equal(latest.has("broken"), false);
});

test("splitByActivity keeps active users in order and drops the lapsed and the never-active", () => {
	const latest = lastActivityByUser(FIXTURE_ROWS);
	const audience = [
		{ userId: "lapsed", recipients: [] },
		{ userId: "daily", recipients: [] },
		{ userId: "no-rows", recipients: [] },
		{ userId: "reader", recipients: [] },
	];
	const { active, inactive } = splitByActivity(audience, latest, NOW, PUSH_ACTIVITY_WINDOW_MS);
	assert.deepEqual(active.map((a) => a.userId), ["daily", "reader"]);
	assert.deepEqual(inactive.map((a) => a.userId), ["lapsed", "no-rows"]);
});

test("the audio window is narrower: a user active 12 days ago gets a push but no pre-made narration", () => {
	const latest = lastActivityByUser(FIXTURE_ROWS);
	assert.equal(isActiveWithin(latest, "reader", NOW, PUSH_ACTIVITY_WINDOW_MS), true);
	assert.equal(isActiveWithin(latest, "reader", NOW, AUDIO_ACTIVITY_WINDOW_MS), false);
	assert.equal(isActiveWithin(latest, "daily", NOW, AUDIO_ACTIVITY_WINDOW_MS), true);
});

test("window edges are inclusive", () => {
	const latest = lastActivityByUser([{ userId: "edge", lastActiveAt: daysAgo(30) }]);
	assert.equal(isActiveWithin(latest, "edge", NOW, PUSH_ACTIVITY_WINDOW_MS), true);
	const past = lastActivityByUser([{ userId: "edge", lastActiveAt: new Date(daysAgo(30).getTime() - 1) }]);
	assert.equal(isActiveWithin(past, "edge", NOW, PUSH_ACTIVITY_WINDOW_MS), false);
});

test("the cron filters before the per-run cap and gates audio on the 7-day window", async () => {
	const route = await read("src/app/api/cron/verse-of-day/route.ts");
	const filter = route.indexOf("splitByActivity(planned");
	const cap = route.indexOf("active.slice(0, MAX_USERS_PER_RUN)");
	assert.ok(filter > 0 && cap > filter, "activity filter must run before the MAX_USERS_PER_RUN slice");
	assert.match(route, /isActiveWithin\(recentActivity, userId, now, AUDIO_ACTIVITY_WINDOW_MS\)/);
	assert.match(route, /skippedInactiveUsers: inactive\.length/);
	// Every activity source the plan names is part of the one grouped query.
	for (const source of ['"Message"', '"ReadingEvent"', '"VerseHighlight"', '"Note"']) {
		assert.ok(route.includes(source), `activity query reads ${source}`);
	}
});
