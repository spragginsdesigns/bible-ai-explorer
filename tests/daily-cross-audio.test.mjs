import assert from "node:assert/strict";
import test from "node:test";

import {
	AUDIO_PENDING_TTL_MS,
	MAX_SPOKEN_CHARACTERS,
	countSpokenWords,
	dailyCrossAudioPathname,
	estimateSpokenDurationSec,
	isSpeechConfigured,
	resolveStoredAudio,
	sanitizeDevotionalScript,
	sanitizeDevotionalTitle,
} from "../src/lib/daily-cross-audio-script.ts";
import {
	LISTEN_URL_STALE_AFTER_MS,
	formatClock,
	listenPhase,
	shouldPollListen,
	shouldRefreshListenUrl,
} from "../src/components/cross/listen.ts";

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

test("an unconfigured server hides the card outright, tap or no tap", () => {
	// This is what production serves until the key is added, so it must never
	// reach a Listen button that can only fail.
	assert.equal(listenPhase({ status: "unavailable", url: null }, false), "hidden");
	assert.equal(listenPhase({ status: "unavailable", url: null }, true), "hidden");
	assert.equal(shouldPollListen("hidden"), false);
});

test("the card waits from the tap, not from the server's first answer", () => {
	assert.equal(listenPhase(null, false), "idle");
	assert.equal(listenPhase(null, true), "preparing");
	assert.equal(listenPhase({ status: "pending", url: null }, true), "preparing");
	assert.equal(listenPhase({ status: "failed", url: null }, true), "failed");
	assert.equal(listenPhase({ status: "ready", url: "https://blob/x.mp3" }, false), "ready");
	// A ready row with no URL is not playable.
	assert.equal(listenPhase({ status: "ready", url: null }, false), "idle");

	assert.equal(shouldPollListen("preparing"), true);
	assert.equal(shouldPollListen("ready"), false);
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
