/**
 * Voice Study (LC-17653, docs/beta/voice.md): the pure rules in
 * src/lib/beta/voice/voice-rules.ts, plus source contracts the realtime path
 * must keep: the key stays on the server, every route is gated, and Scripture
 * is only ever heard from the narrated KJV.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
	EMPTY_VOICE_USAGE,
	READ_SCRIPTURE_TOOL,
	VOICE_MODEL,
	VOICE_SCRIPTURE_TOOLS,
	VOICE_TRANSCRIPTION_MODEL,
	VOICE_TURNS_MAX,
	addResponseUsage,
	addTranscriptionUsage,
	buildVoiceNoteMarkdown,
	checkVoiceTurns,
	isLikelyNarrationEcho,
	isVoiceScriptureTool,
	isWorthKeeping,
	narrationClip,
	parseVoiceUsage,
	verseAtTime,
	voiceCostUsd,
	voiceSessionTitle,
	voiceTranscriptText,
} from "../src/lib/beta/voice/voice-rules.ts";
import { BETA_MODULES } from "../src/lib/beta/modules.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("the realtime models are the current, non-deprecated ones", () => {
	assert.equal(VOICE_MODEL, "gpt-realtime-2.1");
	assert.equal(VOICE_TRANSCRIPTION_MODEL, "gpt-live-transcribe");
	const session = read("src/lib/beta/voice/session.ts");
	for (const retired of ["gpt-4o-mini-tts", "tts-1", "gpt-4o-mini-transcribe", '"gpt-realtime"']) {
		assert.equal(session.includes(retired), false, `${retired} is deprecated`);
	}
});

test("only the chat Scripture tools run on the server for voice", () => {
	assert.deepEqual([...VOICE_SCRIPTURE_TOOLS], ["searchScripture", "findVerses", "getPassage", "getCrossReferences"]);
	assert.equal(isVoiceScriptureTool("getPassage"), true);
	for (const name of [READ_SCRIPTURE_TOOL, "saveMemory", "webSearch", "updateNote", "", null, 3]) assert.equal(isVoiceScriptureTool(name), false, String(name));
});

test("turns are cleaned and anything else is refused", () => {
	const ok = checkVoiceTurns([
		{ role: "user", text: "  What does   Romans 5 teach? " },
		{ role: "assistant", text: "Peace with God, Romans 5:1.", interrupted: true },
		{ role: "reading", text: "Romans 5" },
		{ role: "user", text: "   " },
	]);
	assert.equal(ok.ok, true);
	assert.deepEqual(ok.value, [
		{ role: "user", text: "What does Romans 5 teach?" },
		{ role: "assistant", text: "Peace with God, Romans 5:1.", interrupted: true },
		{ role: "reading", text: "Romans 5" },
	]);
	for (const bad of [null, "turns", {}, [{ role: "system", text: "x" }], [{ role: "user", text: 4 }], [{ role: "user", text: "x", interrupted: "yes" }], [null]]) {
		assert.equal(checkVoiceTurns(bad).ok, false, JSON.stringify(bad));
	}
	assert.equal(checkVoiceTurns(Array.from({ length: VOICE_TURNS_MAX + 1 }, () => ({ role: "user", text: "a" }))).ok, false);
	assert.equal(checkVoiceTurns([{ role: "reading", text: "x".repeat(81) }]).ok, false, "a reading turn is a reference, not verses");
});

test("a conversation is kept only once something was asked and answered", () => {
	assert.equal(isWorthKeeping([]), false);
	assert.equal(isWorthKeeping([{ role: "user", text: "hello" }]), false);
	assert.equal(isWorthKeeping([{ role: "assistant", text: "hello" }]), false);
	assert.equal(isWorthKeeping([{ role: "user", text: "Read me Psalm 23" }, { role: "reading", text: "Psalms 23" }]), true);
});

test("the title is the first question, cut on a word", () => {
	assert.equal(voiceSessionTitle([]), "Voice study");
	assert.equal(voiceSessionTitle([{ role: "assistant", text: "Hi" }, { role: "user", text: "Who was Melchizedek?" }]), "Who was Melchizedek");
	const long = "What does the Bible say about how the covenant with Abraham connects to the promise of the Spirit in Galatians three";
	const title = voiceSessionTitle([{ role: "user", text: long }]);
	assert.ok(title.length <= 93 && title.endsWith("...") && !title.includes("Galatians"), title);
	assert.equal(voiceTranscriptText([{ role: "user", text: "Q" }, { role: "assistant", text: "A", interrupted: true }, { role: "reading", text: "John 3" }]), "You: Q\nSureWord: A (interrupted)\nRead aloud: John 3");
});

test("the note quotes the passages it was given, in the house blockquote shape", () => {
	const markdown = buildVoiceNoteMarkdown({
		dateLabel: "October 26, 2026",
		turns: [
			{ role: "user", text: "Read me Romans 5:1-2" },
			{ role: "reading", text: "Romans 5:1-2" },
			{ role: "assistant", text: "That is Romans 5:1-2.", interrupted: true },
		],
		passages: [
			{ reference: "Romans 5:1-2", heard: true, verses: [{ verse: 1, text: "Therefore being justified by faith," }, { verse: 2, text: "By whom also" }] },
			{ reference: "John 3:16", heard: false, verses: [{ verse: 16, text: "For God so loved the world," }] },
			{ reference: "Nowhere 1:1", heard: false, verses: [] },
		],
	});
	assert.match(markdown, /^- Voice Study, October 26, 2026\n/);
	assert.match(markdown, /\*\*Me:\*\* Read me Romans 5:1-2/);
	assert.match(markdown, /\*Read aloud from the narrated KJV: Romans 5:1-2\*/);
	assert.match(markdown, /\*\*SureWord:\*\* That is Romans 5:1-2\. \*\(interrupted\)\*/);
	assert.match(markdown, /> 1 Therefore being justified by faith,\n> 2 By whom also\n> — Romans 5:1-2, KJV/);
	assert.match(markdown, /> For God so loved the world,\n> — John 3:16, KJV/, "a single verse is quoted without its number");
	assert.equal(markdown.includes("Nowhere"), false, "a passage with no verses is left out");
});

test("a narration clip starts at the first verse, or at 0 for a whole chapter", () => {
	const timings = [
		{ verse: 1, start: 4.2, end: 9.1 },
		{ verse: 2, start: 9.1, end: 15 },
		{ verse: 3, start: 15, end: 22.5 },
	];
	assert.deepEqual(narrationClip(timings, 1, 3, true), { start: 0, end: 22.5 });
	assert.deepEqual(narrationClip(timings, 2, 3, false), { start: 9.1, end: 22.5 });
	assert.deepEqual(narrationClip(timings, 2, 2, false), { start: 9.1, end: 15 });
	assert.equal(narrationClip(timings, 2, 4, false), null, "verses the recording lacks are not guessed");
	assert.equal(narrationClip(timings, 3, 1, false), null);
	assert.equal(verseAtTime(timings, 1), null, "the spoken heading comes before verse 1");
	assert.equal(verseAtTime(timings, 9.1), 2);
	assert.equal(verseAtTime(timings, 30), 3);
});

test("the narration leaking into the microphone is told apart from the listener", () => {
	const playing = "Therefore being justified by faith, we have peace with God through our Lord Jesus Christ: By whom also we have access by faith into this grace wherein we stand";
	assert.equal(isLikelyNarrationEcho("", playing), true, "nothing heard is not an interruption");
	assert.equal(isLikelyNarrationEcho("we have peace with God through our Lord Jesus Christ", playing), true);
	assert.equal(isLikelyNarrationEcho("Stop.", playing), false);
	assert.equal(isLikelyNarrationEcho("Wait, what does justified mean?", playing), false);
	assert.equal(isLikelyNarrationEcho("Can you read verse eight again", playing), false);
	assert.equal(isLikelyNarrationEcho("peace with God", ""), false);
});

test("usage adds up from response.done and transcription events, and prices at list", () => {
	let usage = addResponseUsage(EMPTY_VOICE_USAGE, {
		input_tokens: 5000,
		output_tokens: 1300,
		input_token_details: { text_tokens: 4800, audio_tokens: 200, cached_tokens: 4000, cached_tokens_details: { text_tokens: 3900, audio_tokens: 100 } },
		output_token_details: { text_tokens: 100, audio_tokens: 1200 },
	});
	usage = addTranscriptionUsage(usage, { type: "duration", seconds: 30 });
	usage = addTranscriptionUsage(usage, { type: "tokens", total_tokens: 99 });
	usage = addResponseUsage(usage, null);
	assert.deepEqual(usage, { textInput: 900, textCachedInput: 3900, textOutput: 100, audioInput: 100, audioCachedInput: 100, audioOutput: 1200, transcribedSeconds: 30 });
	const cost = voiceCostUsd(usage);
	// 900*4 + 3900*0.4 + 100*24 + 100*32 + 100*0.4 + 1200*64 per 1M, + half a minute at $0.017.
	assert.ok(Math.abs(cost - (0.0036 + 0.00156 + 0.0024 + 0.0032 + 0.00004 + 0.0768 + 0.0085)) < 1e-9, String(cost));
	assert.deepEqual(parseVoiceUsage({ textInput: -3, audioOutput: "9", transcribedSeconds: 12 }), { ...EMPTY_VOICE_USAGE, transcribedSeconds: 12 });
});

test("the key stays on the server and every voice route is gated", () => {
	const engine = read("src/components/beta/voice/voiceEngine.ts");
	assert.equal(/OPENAI|api\.openai\.com|Bearer/.test(engine), false, "the browser never talks to OpenAI with a credential");
	assert.match(engine, /\/api\/beta\/voice\/call/);
	assert.match(engine, /\/api\/bible\/audio\?book=/, "readings play the Audio Bible");
	const session = read("src/lib/beta/voice/session.ts");
	assert.match(session, /import "server-only"/);
	assert.match(session, /process\.env\.OPENAI_API_KEY/);
	assert.match(session, /OpenAI-Safety-Identifier/);
	for (const route of [
		"src/app/api/beta/voice/call/route.ts",
		"src/app/api/beta/voice/tool/route.ts",
		"src/app/api/beta/voice/sessions/route.ts",
		"src/app/api/beta/voice/sessions/[id]/route.ts",
		"src/app/api/beta/voice/sessions/[id]/note/route.ts",
	]) {
		const source = read(route);
		const gate = source.indexOf("await requireBetaApi()");
		assert.ok(gate > 0, `${route} is gated`);
		for (const call of ["createVoiceCall(", "runVoiceScriptureTool(", "planVoiceReading(", "saveVoiceSession(", "listVoiceSessions(", "getVoiceSession(", "deleteVoiceSession(", "saveVoiceSessionNote(", "req.text()"]) {
			const at = source.indexOf(call);
			if (at !== -1) assert.ok(at > gate, `${route}: ${call} runs only after the gate`);
		}
	}
});

test("the prompt routes Scripture to the narration and grounds answers in the chat tools", () => {
	const prompt = read("src/lib/beta/voice/prompt.ts");
	assert.match(prompt, /doctrinalFoundation/);
	assert.match(prompt, /Never read, recite or quote a verse aloud yourself/);
	assert.match(prompt, /call \$\{READ_SCRIPTURE_TOOL\}/);
	assert.doesNotMatch(prompt, /quotationGuidance\(/, "chat's quote-the-exact-text rule never reaches a speech-to-speech prompt");
	for (const tool of VOICE_SCRIPTURE_TOOLS) assert.match(prompt, new RegExp(tool));
	const tools = read("src/lib/beta/voice/tools.ts");
	assert.match(tools, /buildSureWordTools\(/, "the voice tools are the chat tools, not copies");
});

test("the registry entry says what shipped", () => {
	const entry = BETA_MODULES.find((module) => module.slug === "voice");
	assert.equal(entry.status, "live");
	assert.equal(entry.issue, "LC-17653");
	assert.equal(entry.destination, "study");
});
