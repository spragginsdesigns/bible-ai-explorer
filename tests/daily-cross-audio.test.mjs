import assert from "node:assert/strict";
import test from "node:test";

import {
	AUDIO_PENDING_TTL_MS,
	DAILY_CROSS_AUDIO_STREAM_PATH,
	MAX_SPOKEN_CHARACTERS,
	countSpokenWords,
	dailyCrossAudioPathname,
	devotionalStreamResponseInit,
	estimateSpokenDurationSec,
	isSpeechConfigured,
	resolveStoredAudio,
	sanitizeDevotionalScript,
	sanitizeDevotionalTitle,
} from "../src/lib/daily-cross-audio-script.ts";
import {
	DEFAULT_LISTEN_RATE,
	LISTEN_RATES,
	LISTEN_URL_STALE_AFTER_MS,
	formatClock,
	formatListenRate,
	listenPhase,
	nextListenRate,
	normalizeListenRate,
	shouldPollListen,
	shouldRefreshListenUrl,
} from "../src/components/cross/listen.ts";
import { parseUserIdAllowlist, resolvePlan } from "../src/lib/entitlements-rules.ts";

test("markdown a narrator would read out loud is stripped", () => {
	const script = sanitizeDevotionalScript(
		"## Today's Word\n\n**Good morning.** Hear _the_ verse:\n\n> For God so loved the world.\n\n- Read John three\n1. Then pray\n\nAmen."
	);
	assert.equal(
		script,
		"Today's Word\n\nGood morning. Hear the verse:\n\nFor God so loved the world.\n\nRead John three\nThen pray\n\nAmen."
	);
	assert.ok(!script.includes("#"));
	assert.ok(!script.includes("*"));
	assert.ok(!script.includes(">"));
});

test("stage directions are removed rather than spoken", () => {
	assert.equal(
		sanitizeDevotionalScript("[pause] Good morning. [Narrator] Take a breath (softly) and listen."),
		"Good morning. Take a breath and listen."
	);
});

test("blank-line runs collapse to a single paragraph break", () => {
	assert.equal(sanitizeDevotionalScript("One.\n\n\n\nTwo.\n\n\nThree."), "One.\n\nTwo.\n\nThree.");
});

test("a runaway script is cut at a boundary, under the ElevenLabs request cap", () => {
	const paragraph = `${"word ".repeat(200).trim()}.`;
	const script = sanitizeDevotionalScript(Array.from({ length: 20 }, () => paragraph).join("\n\n"));
	assert.ok(script.length <= MAX_SPOKEN_CHARACTERS);
	assert.ok(script.endsWith("."), "a trimmed script must not end mid-word");
});

test("a title is one plain line, and never empty", () => {
	assert.equal(sanitizeDevotionalTitle("**A Sure Word:**", "John 3:16"), "A Sure Word");
	assert.equal(sanitizeDevotionalTitle('"Stand Fast"', "John 3:16"), "Stand Fast");
	assert.equal(sanitizeDevotionalTitle("   ", "John 3:16"), "John 3:16");
});

test("duration is estimated from the word count at reading pace", () => {
	const script = `${"word ".repeat(150).trim()}.`;
	assert.equal(countSpokenWords(script), 150);
	assert.equal(estimateSpokenDurationSec(script), 60);
	assert.equal(estimateSpokenDurationSec(""), 0);
});

test("stored audio is served, awaited or regenerated", () => {
	const now = Date.UTC(2026, 7, 26, 12, 0, 0);
	const fresh = new Date(now - 30_000);
	const stale = new Date(now - AUDIO_PENDING_TTL_MS - 1);

	assert.equal(
		resolveStoredAudio(
			{ audioStatus: "ready", audioPathname: "a/b.mp3", audioGeneratedAt: fresh },
			now
		),
		"ready"
	);
	assert.equal(
		resolveStoredAudio({ audioStatus: "pending", audioPathname: null, audioGeneratedAt: fresh }, now),
		"pending"
	);
	// A generation that died mid-flight must not wedge the day.
	assert.equal(
		resolveStoredAudio({ audioStatus: "pending", audioPathname: null, audioGeneratedAt: stale }, now),
		"generate"
	);
	assert.equal(
		resolveStoredAudio({ audioStatus: "failed", audioPathname: null, audioGeneratedAt: fresh }, now),
		"generate"
	);
	assert.equal(
		resolveStoredAudio({ audioStatus: null, audioPathname: null, audioGeneratedAt: null }, now),
		"generate"
	);
	// "ready" without a blob path is a broken row, not a playable one.
	assert.equal(
		resolveStoredAudio({ audioStatus: "ready", audioPathname: null, audioGeneratedAt: fresh }, now),
		"generate"
	);
});

test("one blob path per day, scoped to the user", () => {
	assert.equal(
		dailyCrossAudioPathname("user_123", "cross_abc"),
		"daily-cross-audio/user_123/cross_abc.mp3"
	);
});

test("a deployment with no ElevenLabs key is not configured for speech", () => {
	assert.equal(isSpeechConfigured(undefined), false);
	assert.equal(isSpeechConfigured(null), false);
	assert.equal(isSpeechConfigured(""), false);
	// A key that is only whitespace is an unset key someone half-filled in.
	assert.equal(isSpeechConfigured("   "), false);
	assert.equal(isSpeechConfigured("sk_live_abc123"), true);
});

test("an unconfigured server hides the card outright, plan or no plan", () => {
	// This is what production serves until the key is added, so it must never
	// reach a Listen control that can only fail. Outranks even Pro.
	assert.equal(listenPhase({ status: "unavailable", url: null, plan: "free" }), "hidden");
	assert.equal(listenPhase({ status: "unavailable", url: null, plan: "pro" }), "hidden");
	assert.equal(shouldPollListen("hidden"), false);
});

test("the card waits by default - audio is made with the day, not on a tap", () => {
	// There is no invitation to tap any more: a card on screen means a day
	// exists, and a stored day always schedules its own narration.
	assert.equal(listenPhase(null), "preparing");
	assert.equal(listenPhase({ status: "none", url: null }), "preparing");
	assert.equal(listenPhase({ status: "pending", url: null }), "preparing");
	assert.equal(listenPhase({ status: "failed", url: null }), "failed");
	assert.equal(listenPhase({ status: "ready", url: "https://blob/x.mp3" }), "ready");
	// A ready row with no URL is not playable; keep waiting rather than show a
	// player with nothing in it.
	assert.equal(listenPhase({ status: "ready", url: null }), "preparing");

	assert.equal(shouldPollListen("preparing"), true);
	assert.equal(shouldPollListen("ready"), false);
});

test("a free account sees the Pro panel, and never polls behind it", () => {
	assert.equal(listenPhase({ status: "locked", url: null, plan: "free" }), "locked");
	// Polling a locked card would be one request every three seconds, forever,
	// for an answer that cannot change.
	assert.equal(shouldPollListen("locked"), false);
});

test("Pro comes from the column or the allowlist, and a typo grants nothing", () => {
	const allowlist = ["user_austin"];

	assert.equal(resolvePlan({ plan: "pro", userId: "user_x", allowlist: [] }), "pro");
	assert.equal(resolvePlan({ plan: "free", userId: "user_x", allowlist: [] }), "free");
	// The allowlist exists precisely for accounts nothing has written a plan
	// for, so it must win over an absent or free column.
	assert.equal(resolvePlan({ plan: null, userId: "user_austin", allowlist }), "pro");
	assert.equal(resolvePlan({ plan: "free", userId: "user_austin", allowlist }), "pro");
	// Anything unrecognised is free - a typo in that column must never hand out
	// a paid feature.
	assert.equal(resolvePlan({ plan: "Pro", userId: "user_x", allowlist }), "free");
	assert.equal(resolvePlan({ plan: "premium", userId: "user_x", allowlist }), "free");
	assert.equal(resolvePlan({ plan: undefined, userId: "user_x", allowlist }), "free");
});

test("the allowlist env is parsed the same way as SERVER_CREDENTIAL_USER_IDS", () => {
	assert.deepEqual(parseUserIdAllowlist("a, b ,c"), ["a", "b", "c"]);
	assert.deepEqual(parseUserIdAllowlist(""), []);
	assert.deepEqual(parseUserIdAllowlist(undefined), []);
	// A trailing comma is a typo, not an empty user id that matches nothing.
	assert.deepEqual(parseUserIdAllowlist("a,,b,"), ["a", "b"]);
});

test("the speed chip cycles every rate, wraps, and never leaves the set", () => {
	const seen = [DEFAULT_LISTEN_RATE];
	for (let step = 0; step < LISTEN_RATES.length - 1; step++) {
		seen.push(nextListenRate(seen[seen.length - 1]));
	}
	assert.equal(new Set(seen).size, LISTEN_RATES.length);
	assert.equal(nextListenRate(seen[seen.length - 1]), DEFAULT_LISTEN_RATE);
	// A rate this build no longer offers restarts the cycle rather than sitting
	// outside it forever.
	assert.ok(LISTEN_RATES.includes(nextListenRate(3.5)));
});

test("a stored speed is normalized, including the string localStorage returns", () => {
	assert.equal(normalizeListenRate("1.5"), 1.5);
	assert.equal(normalizeListenRate(1.5), 1.5);
	assert.equal(normalizeListenRate("banana"), DEFAULT_LISTEN_RATE);
	assert.equal(normalizeListenRate(null), DEFAULT_LISTEN_RATE);
	// A rate we do not offer must not reach the player.
	assert.equal(normalizeListenRate(4), DEFAULT_LISTEN_RATE);

	assert.equal(formatListenRate(1), "1x");
	assert.equal(formatListenRate(0.75), "0.75x");
});

test("a stale signed URL earns exactly one silent refresh", () => {
	const now = Date.UTC(2026, 7, 26, 12, 0, 0);
	const stale = now - LISTEN_URL_STALE_AFTER_MS - 1;
	const fresh = now - 30_000;

	assert.equal(shouldRefreshListenUrl(stale, false, now), true);
	// One retry only: a genuinely dead blob must not loop.
	assert.equal(shouldRefreshListenUrl(stale, true, now), false);
	// A URL fetched moments ago that fails is a real failure, not an expiry.
	assert.equal(shouldRefreshListenUrl(fresh, false, now), false);
	assert.equal(shouldRefreshListenUrl(null, false, now), false);
});

test("the clock never shows NaN", () => {
	assert.equal(formatClock(0), "0:00");
	assert.equal(formatClock(75), "1:15");
	assert.equal(formatClock(3725), "1:02:05");
	assert.equal(formatClock(Number.NaN), "0:00");
	assert.equal(formatClock(-3), "0:00");
});

test("a whole-file proxy answer is a plain 200 that advertises range support", () => {
	const { status, headers } = devotionalStreamResponseInit({
		contentType: "audio/mpeg",
		contentLength: "3612480",
		contentRange: null,
	});

	assert.equal(status, 200);
	assert.equal(headers["Content-Type"], "audio/mpeg");
	assert.equal(headers["Content-Length"], "3612480");
	// Without this a media element cannot seek, whatever the body contains.
	assert.equal(headers["Accept-Ranges"], "bytes");
	assert.equal(headers["Content-Disposition"], "inline");
	// One listener's devotional must never land in a shared cache.
	assert.equal(headers["Cache-Control"], "private, max-age=0");
	assert.ok(!("Content-Range" in headers));
});

test("a range the blob host honoured is passed through as a 206", () => {
	const { status, headers } = devotionalStreamResponseInit({
		contentType: "audio/mpeg",
		contentLength: "1024",
		contentRange: "bytes 2048-3071/3612480",
	});

	assert.equal(status, 206);
	assert.equal(headers["Content-Range"], "bytes 2048-3071/3612480");
	assert.equal(headers["Content-Length"], "1024");
});

test("a range the blob host ignored is answered 200, never a lying 206", () => {
	// The client asked for bytes=0- and was handed the whole file. Claiming a
	// partial response here is something a media player acts on.
	const { status, headers } = devotionalStreamResponseInit({
		contentType: "audio/mpeg",
		contentLength: "3612480",
		contentRange: null,
	});

	assert.equal(status, 200);
	assert.ok(!("Content-Range" in headers));
});

test("the proxy always answers as audio, whatever the blob host calls it", () => {
	// An `application/octet-stream` here would put a media element straight back
	// into the state this proxy exists to fix.
	assert.equal(
		devotionalStreamResponseInit({ contentType: "application/octet-stream" }).headers[
			"Content-Type"
		],
		"audio/mpeg"
	);
	assert.equal(
		devotionalStreamResponseInit({ contentType: null }).headers["Content-Type"],
		"audio/mpeg"
	);
	// A real audio type is kept as the host gave it.
	assert.equal(
		devotionalStreamResponseInit({ contentType: "audio/mpeg; charset=binary" }).headers[
			"Content-Type"
		],
		"audio/mpeg; charset=binary"
	);
});

test("malformed upstream length and range headers are dropped, not forwarded", () => {
	const { status, headers } = devotionalStreamResponseInit({
		contentType: "audio/mpeg",
		contentLength: "not-a-number",
		contentRange: "items 0-1/2",
	});

	assert.equal(status, 200);
	assert.ok(!("Content-Length" in headers));
	assert.ok(!("Content-Range" in headers));
});

test("clients are pointed at our own origin, not the blob host", () => {
	assert.equal(DAILY_CROSS_AUDIO_STREAM_PATH, "/api/verse-of-day/audio/stream");
	assert.ok(
		DAILY_CROSS_AUDIO_STREAM_PATH.startsWith("/"),
		"the path is relative so web plays it same-origin and Android joins it onto API_URL"
	);
});
