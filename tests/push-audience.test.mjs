import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
	MAX_MORNING_DEVICES_PER_USER,
	STALE_TOKEN_AFTER_MS,
	chatReplyRecipientWhere,
	chunkByRecipients,
	classifyTickets,
	planMorningAudience,
} from "../src/lib/push-audience.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const NOW = new Date("2026-09-12T15:00:00Z");
const HOUR = 60 * 60 * 1000;

/** Stand-in for the cron's Intl-based localHour: a fixed offset per zone. */
const OFFSETS = { "America/Los_Angeles": -7, "America/Chicago": -5, "Invalid/Zone": null };
const localHour = (timezone, now) => {
	const offset = OFFSETS[timezone];
	if (offset === null || offset === undefined) return null;
	return (((now.getUTCHours() + offset) % 24) + 24) % 24;
};

let nextId = 0;
const token = (overrides) => {
	nextId += 1;
	return {
		id: `pt_${nextId}`,
		userId: "user_a",
		token: `ExponentPushToken[${nextId}]`,
		timezone: "America/Los_Angeles",
		notifyHour: 8,
		updatedAt: new Date(NOW.getTime() - nextId * 1000),
		...overrides,
	};
};

test("143 tokens for one user produce one push to that user's newest devices", () => {
	const tokens = Array.from({ length: 143 }, () => token({}));
	const audience = planMorningAudience(tokens, NOW, localHour);
	assert.equal(audience.length, 1);
	assert.equal(audience[0].userId, "user_a");
	assert.equal(audience[0].recipients.length, MAX_MORNING_DEVICES_PER_USER);
	// Newest first: the token helper makes later ids older.
	assert.deepEqual(
		audience[0].recipients.map((r) => r.tokenId),
		tokens.slice(0, MAX_MORNING_DEVICES_PER_USER).map((t) => t.id),
	);
});

test("a message with more recipients than Expo's limit spans requests, each device once", () => {
	const recipients = Array.from({ length: 143 }, (_, i) => ({ tokenId: `pt_x${i}`, to: `ExponentPushToken[x${i}]` }));
	const chunks = chunkByRecipients([{ userId: "user_a", recipients, title: "t" }], 100);
	// Expo's 100 limit counts recipients, so one user's message spans two
	// requests - still one logical push, and every device appears exactly once.
	assert.equal(chunks.length, 2);
	assert.deepEqual(chunks.map((chunk) => chunk.flatMap((piece) => piece.recipients).length), [100, 43]);
	const sentTo = chunks.flat().flatMap((piece) => piece.recipients.map((r) => r.to));
	assert.equal(new Set(sentTo).size, 143);
});

test("tokens that disagree on hour cannot fire in more than one hour", () => {
	const newest = token({ notifyHour: 8, updatedAt: new Date(NOW.getTime() - HOUR) });
	const older = token({ notifyHour: 9, updatedAt: new Date(NOW.getTime() - 2 * HOUR) });
	const at8 = planMorningAudience([older, newest], NOW, localHour);
	assert.equal(at8.length, 1);
	assert.deepEqual(at8[0].recipients.map((r) => r.tokenId), [newest.id, older.id]);

	const at9 = planMorningAudience([older, newest], new Date(NOW.getTime() + HOUR), localHour);
	assert.equal(at9.length, 0, "the older token's hour no longer triggers a second morning push");
});

test("the newest token's timezone decides due-ness", () => {
	const newest = token({ timezone: "America/Chicago", notifyHour: 10, updatedAt: NOW });
	const older = token({ timezone: "America/Los_Angeles", notifyHour: 8, updatedAt: new Date(NOW.getTime() - HOUR) });
	// 15:00Z is 10:00 in Chicago and 08:00 in Los Angeles.
	const audience = planMorningAudience([older, newest], NOW, localHour);
	assert.equal(audience.length, 1);
	assert.equal(audience[0].recipients.length, 2);

	const invalid = token({ timezone: "Invalid/Zone", updatedAt: new Date(NOW.getTime() + HOUR) });
	assert.equal(planMorningAudience([older, newest, invalid], NOW, localHour).length, 0);
});

test("two users produce two pushes", () => {
	const tokens = [
		token({ userId: "user_a" }),
		token({ userId: "user_b" }),
		token({ userId: "user_a" }),
		token({ userId: "user_c", notifyHour: 7 }),
	];
	const audience = planMorningAudience(tokens, NOW, localHour);
	assert.deepEqual(audience.map((entry) => entry.userId).sort(), ["user_a", "user_b"]);
	assert.equal(audience.find((entry) => entry.userId === "user_a").recipients.length, 2);
	assert.equal(chunkByRecipients(audience, 100).flat().length, 2);
});

test("duplicate token strings collapse to one recipient", () => {
	const shared = "ExponentPushToken[same-device]";
	const first = token({ token: shared, updatedAt: NOW });
	const second = token({ token: shared, updatedAt: new Date(NOW.getTime() - HOUR) });
	const other = token({});
	const audience = planMorningAudience([second, first, other], NOW, localHour);
	assert.equal(audience.length, 1);
	assert.deepEqual(audience[0].recipients, [
		{ tokenId: first.id, to: shared },
		{ tokenId: other.id, to: other.token },
	]);

	const chunks = chunkByRecipients(
		[{ recipients: [{ tokenId: "a", to: shared }, { tokenId: "b", to: shared }] }],
		100,
	);
	assert.deepEqual(chunks.flat()[0].recipients, [{ tokenId: "a", to: shared }]);
});

test("tokens far behind the user's newest are dropped as stale installs", () => {
	const current = token({ updatedAt: NOW });
	const recent = token({ updatedAt: new Date(NOW.getTime() - STALE_TOKEN_AFTER_MS) });
	const abandoned = token({ updatedAt: new Date(NOW.getTime() - STALE_TOKEN_AFTER_MS - 1) });
	const audience = planMorningAudience([abandoned, recent, current], NOW, localHour);
	assert.deepEqual(audience[0].recipients.map((r) => r.tokenId), [current.id, recent.id]);

	// Staleness is relative, so a user who has not opened the app in months
	// still gets their morning verse on the device they last used.
	const lapsed = token({ userId: "user_lapsed", updatedAt: new Date(NOW.getTime() - 200 * 24 * HOUR) });
	assert.equal(planMorningAudience([lapsed], NOW, localHour)[0].recipients.length, 1);
});

test("chatReplies true with enabled false still receives a chat-reply push", () => {
	const where = chatReplyRecipientWhere("user_a");
	assert.deepEqual(where, { userId: "user_a", chatReplies: true });
	assert.equal("enabled" in where, false);

	const rows = [
		{ id: "morning_off", userId: "user_a", enabled: false, chatReplies: true },
		{ id: "replies_off", userId: "user_a", enabled: true, chatReplies: false },
		{ id: "other_user", userId: "user_b", enabled: true, chatReplies: true },
	];
	const matches = rows.filter((row) => Object.entries(where).every(([key, value]) => row[key] === value));
	assert.deepEqual(matches.map((row) => row.id), ["morning_off"]);
});

test("notifyChatAnswerReady and the cron use the shared audience rules", async () => {
	const [push, cron] = await Promise.all([
		read("src/lib/push.ts"),
		read("src/app/api/cron/verse-of-day/route.ts"),
	]);
	assert.match(push, /where: chatReplyRecipientWhere\(options\.userId\)/);
	assert.doesNotMatch(push, /enabled: true, chatReplies: true/);
	assert.match(cron, /planMorningAudience\(enabledTokens, now, localHour\)/);
	assert.doesNotMatch(cron, /tokens\.map\(\(token\): PendingPush/);
});

test("tickets map back to devices across multi-recipient messages", () => {
	const chunk = chunkByRecipients(
		[
			{ recipients: [{ tokenId: "a1", to: "A1" }, { tokenId: "a2", to: "A2" }] },
			{ recipients: [{ tokenId: "b1", to: "B1" }] },
		],
		100,
	)[0];
	const recipients = chunk.flatMap((piece) => piece.recipients);
	const result = classifyTickets(recipients, [
		{ status: "ok" },
		{ status: "error", details: { error: "DeviceNotRegistered" } },
		{ status: "error", details: { error: "MessageRateExceeded" } },
	]);
	assert.deepEqual(result.retiredTokenIds, ["a2"]);
	assert.deepEqual(result.errors, [{ error: "MessageRateExceeded" }]);

	// A short or long ticket array never indexes past the devices it describes.
	assert.deepEqual(
		classifyTickets(recipients.slice(0, 1), [
			{ status: "ok" },
			{ status: "error", details: { error: "DeviceNotRegistered" } },
		]).retiredTokenIds,
		[],
	);
});
