// Shared steps for the sermon-study pipeline.
//
// The download and the transcription have to run on a machine with a
// residential IP and a GPU: YouTube answers "Sign in to confirm you're not a
// bot" from datacenter ranges (verified against the LineCrush VPS on
// 2026-09-20), and Vercel functions have neither a GPU nor the wall clock for
// a 76-minute service. Everything after `parseSrt` is ordinary server work and
// is written so it can move into src/lib unchanged.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { generateText, Output } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";

/** Whisper mishears preaching cadence without a domain hint; this is that hint. */
export const WHISPER_PROMPT =
	"First Missionary Baptist Church, FMBC, Fresno. A King James Version Bible sermon. " +
	"Scripture, Jesus Christ, the Lord, brethren, righteousness, repentance, salvation, discipleship. " +
	"Genesis, Leviticus, Deuteronomy, Nehemiah, Psalms, Proverbs, Isaiah, Jeremiah, Ezekiel, Daniel, " +
	"Jonah, Micah, Habakkuk, Haggai, Zechariah, Malachi, Matthew, Mark, Luke, John, Acts, Romans, " +
	"Corinthians, Galatians, Ephesians, Philippians, Colossians, Thessalonians, Timothy, Titus, " +
	"Hebrews, James, Peter, Jude, Revelation. Amen.";

const DEFAULT_TRANSCRIBE_PYTHON =
	"C:/Users/Owner/.claude/tools/transcribe/.venv/Scripts/python.exe";
const DEFAULT_TRANSCRIBE_SCRIPT = "C:/Users/Owner/.claude/tools/transcribe/transcribe.py";

/**
 * Read .env.local without letting an inherited value win. CLAUDE.md documents
 * why: a DATABASE_URL already in the shell beats every dotenv loader, and on
 * this machine it has pointed at an unrelated database before.
 */
export function loadEnv(root) {
	const env = {};
	const file = path.join(root, ".env.local");
	if (!fs.existsSync(file)) return env;
	for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
		const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"#]*)"?\s*$/);
		if (match) env[match[1]] = match[2].trim();
	}
	return env;
}

function run(cmd, args, { capture = false } = {}) {
	return new Promise((resolve, reject) => {
		const child = spawn(cmd, args, {
			stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
			shell: false,
		});
		let out = "";
		let err = "";
		if (capture) {
			child.stdout.on("data", (d) => (out += d));
			child.stderr.on("data", (d) => (err += d));
		}
		child.on("error", reject);
		child.on("close", (code) =>
			code === 0
				? resolve({ out, err })
				: reject(new Error(`${cmd} exited ${code}${err ? `: ${err.slice(-400)}` : ""}`))
		);
	});
}

// ---------------------------------------------------------------- discovery

/**
 * Latest uploads for a channel, newest first, from the public RSS feed. No API
 * key and no quota, unlike the YouTube Data API, and it is not IP-blocked.
 */
export async function discoverUploads(channelId) {
	const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`, {
		headers: { "user-agent": "SureWord sermon pipeline" },
	});
	if (!res.ok) throw new Error(`RSS feed returned ${res.status}`);
	const xml = await res.text();
	const entries = [];
	for (const block of xml.split("<entry>").slice(1)) {
		const videoId = block.match(/<yt:videoId>([^<]+)<\/yt:videoId>/)?.[1];
		const title = block.match(/<title>([^<]*)<\/title>/)?.[1];
		const published = block.match(/<published>([^<]+)<\/published>/)?.[1];
		if (videoId && title) {
			entries.push({ videoId, title: decodeXml(title), published: published ?? null });
		}
	}
	return entries;
}

function decodeXml(s) {
	return s
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'");
}

// ----------------------------------------------------------------- download

/**
 * yt-dlp breaks every few weeks when YouTube changes its player, and a stale
 * binary fails as a 403 or a stall rather than as something obviously fixable.
 * A scheduled run updates first; that already cost one debugging session.
 */
export async function updateYtDlp() {
	try {
		const { out } = await run("yt-dlp", ["-U"], { capture: true });
		return out.trim().split(/\r?\n/).pop() ?? "";
	} catch (error) {
		// An update failure is not fatal: the existing binary may still work.
		return `update skipped: ${error.message}`;
	}
}

/**
 * True while YouTube is still turning a finished livestream into a VOD. In
 * that window the only thing on offer is a live-DVR manifest that downloads at
 * roughly realtime, so the caller should back off and retry rather than fail.
 */
export function looksUnprocessed(message) {
	return /This live event has ended|page needs to be reloaded|Requested format is not available/i.test(
		message
	);
}

export async function downloadAudio(videoId, outPath) {
	await run("yt-dlp", [
		"-f",
		"140/139/bestaudio",
		"--concurrent-fragments",
		"8",
		"--no-progress",
		"-o",
		outPath,
		`https://www.youtube.com/watch?v=${videoId}`,
	]);
	if (!fs.existsSync(outPath)) throw new Error(`yt-dlp produced no file at ${outPath}`);
	return outPath;
}

// -------------------------------------------------------------- transcribe

export async function transcribe(audioPath, srtPath, env = {}) {
	const python = env.TRANSCRIBE_PYTHON || DEFAULT_TRANSCRIBE_PYTHON;
	const script = env.TRANSCRIBE_SCRIPT || DEFAULT_TRANSCRIBE_SCRIPT;
	await run(python, [
		"-u",
		script,
		audioPath,
		"--model",
		"large-v3",
		"--language",
		"en",
		"--prompt",
		WHISPER_PROMPT,
		"--format",
		"srt",
		"--output",
		srtPath,
	]);
	if (!fs.existsSync(srtPath)) throw new Error(`transcription produced no file at ${srtPath}`);
	return srtPath;
}

const TIMECODE = /(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/;

export function parseSrt(text) {
	const cues = [];
	for (const block of text.replace(/\r/g, "").trim().split(/\n\n+/)) {
		const lines = block.split("\n");
		const timing = lines.find((l) => l.includes("-->"));
		if (!timing) continue;
		const [rawStart, rawEnd] = timing.split("-->");
		const startMs = toMs(rawStart);
		const endMs = toMs(rawEnd);
		const body = lines.slice(lines.indexOf(timing) + 1).join(" ").trim();
		if (body && startMs !== null) cues.push({ startMs, endMs: endMs ?? startMs, text: body });
	}
	return cues;
}

function toMs(raw) {
	const m = raw?.match(TIMECODE);
	if (!m) return null;
	return (+m[1] * 3600 + +m[2] * 60 + +m[3]) * 1000 + +m[4];
}

export function formatTimestamp(ms) {
	const total = Math.max(0, Math.round(ms / 1000));
	const h = Math.floor(total / 3600);
	const m = Math.floor((total % 3600) / 60);
	const s = total % 60;
	const mm = String(m).padStart(2, "0");
	const ss = String(s).padStart(2, "0");
	return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

/** Cues as "[12:34] text" lines, which is what both model passes read. */
export function cuesToTranscript(cues) {
	return cues.map((c) => `[${formatTimestamp(c.startMs)}] ${c.text}`).join("\n");
}

export function cuesBetween(cues, startMs, endMs) {
	return cues.filter((c) => c.startMs >= startMs - 1 && c.startMs <= endMs + 1);
}

// --------------------------------------------------------------------- KJV

const BOOK_SLUGS = new Map();

function kjvDir(root) {
	return path.join(root, "src", "data", "kjv");
}

function loadBookIndex(root) {
	if (BOOK_SLUGS.size) return BOOK_SLUGS;
	for (const file of fs.readdirSync(kjvDir(root))) {
		const slug = file.replace(/^\d+-/, "").replace(/\.json$/, "");
		BOOK_SLUGS.set(normalizeBook(slug.replace(/-/g, " ")), file);
	}
	return BOOK_SLUGS;
}

/** "1st Samuel", "I Samuel", "First Samuel" and "1 Samuel" are one book. */
function normalizeBook(name) {
	return String(name)
		.toLowerCase()
		.replace(/\./g, "")
		.replace(/^(first|1st|i)\s+/, "1 ")
		.replace(/^(second|2nd|ii)\s+/, "2 ")
		.replace(/^(third|3rd|iii)\s+/, "3 ")
		.replace(/^psalm$/, "psalms")
		.replace(/^song of solomon$|^song of songs$/, "song of solomon")
		.replace(/\s+/g, " ")
		.trim();
}

/**
 * Parse "Luke 9:57-62" / "1 John 4:7" / "Psalm 23". Returns null rather than
 * guessing, because a reference we cannot resolve must be dropped from the
 * study, never rendered as if it were verified.
 */
export function parseReference(raw) {
	const m = String(raw ?? "")
		.trim()
		.match(/^((?:[1-3]|i{1,3}|first|second|third|1st|2nd|3rd)?\s*[A-Za-z][A-Za-z ]*?)\s+(\d+)(?::(\d+)(?:\s*-\s*(\d+))?)?$/i);
	if (!m) return null;
	const book = normalizeBook(m[1]);
	const chapter = Number(m[2]);
	const verse = m[3] ? Number(m[3]) : null;
	const endVerse = m[4] ? Number(m[4]) : verse;
	return { book, chapter, verse, endVerse };
}

/**
 * The passage as the KJV actually reads it. Quoted scripture is always
 * re-rendered from here and never from the transcript: Whisper is accurate but
 * a single misheard word would otherwise ship as a misquoted verse.
 */
export function lookupPassage(root, reference) {
	const ref = typeof reference === "string" ? parseReference(reference) : reference;
	if (!ref) return null;
	const file = loadBookIndex(root).get(ref.book);
	if (!file) return null;
	const book = JSON.parse(fs.readFileSync(path.join(kjvDir(root), file), "utf8"));
	const chapter = book[ref.chapter - 1];
	if (!chapter) return null;
	const displayBook = file
		.replace(/^\d+-/, "")
		.replace(/\.json$/, "")
		.split("-")
		.map((w) => (/^\d$/.test(w) ? w : w[0].toUpperCase() + w.slice(1)))
		.join(" ");
	if (ref.verse === null) {
		return {
			reference: `${displayBook} ${ref.chapter}`,
			verses: chapter.map((text, i) => ({ verse: i + 1, text })),
		};
	}
	const verses = [];
	for (let v = ref.verse; v <= (ref.endVerse ?? ref.verse); v += 1) {
		const text = chapter[v - 1];
		if (text) verses.push({ verse: v, text });
	}
	if (!verses.length) return null;
	const last = verses[verses.length - 1].verse;
	const label =
		verses.length > 1
			? `${displayBook} ${ref.chapter}:${verses[0].verse}-${last}`
			: `${displayBook} ${ref.chapter}:${verses[0].verse}`;
	return { reference: label, verses };
}

// ------------------------------------------------------------------- model

export function model(env, id) {
	const apiKey = (env.OPENAI_API_KEY || process.env.OPENAI_API_KEY || "").trim();
	if (!apiKey) throw new Error("OPENAI_API_KEY is required (env or .env.local).");
	return createOpenAI({ apiKey })(id);
}

// Every field the model may leave empty is .nullable(), never .optional():
// a single .optional() in an Output.object schema makes OpenAI reject the
// whole request under strict schema validation.
const segmentSchema = z.object({
	sermonStartMs: z
		.number()
		.describe("Millisecond timestamp where the preaching begins, normally where the preacher announces the text."),
	sermonEndMs: z.number().describe("Millisecond timestamp where the preaching ends."),
	preacher: z.string().nullable().describe("Preacher's name if it is said aloud, else null."),
	preachingText: z
		.string()
		.nullable()
		.describe('Canonical reference of the announced text, e.g. "Luke 9:57-62". Null if never stated.'),
	serviceTitle: z.string().describe("Short title for the message, drawn from what was preached."),
	skipped: z
		.array(z.string())
		.describe("One short line per non-sermon stretch that was excluded, e.g. 'announcements, 5:21-31:07'."),
});

const sectionSchema = z.object({
	heading: z.string().describe("Short heading for this movement of the sermon."),
	startMs: z.number().describe("Millisecond timestamp in the recording where this section begins."),
	pastorQuote: z
		.string()
		.describe("A verbatim sentence from the transcript for this section. Never paraphrase here."),
	quoteAtMs: z
		.number()
		.describe(
			"Millisecond timestamp of the [h:mm:ss] mark on the line the quote was copied from. Used to recover the exact wording, so it must point at that line."
		),
	passage: z
		.string()
		.nullable()
		.describe('Canonical reference this section rests on, e.g. "Luke 9:59". Null if none.'),
	explanation: z
		.string()
		.describe("2-4 sentences of SureWord's own teaching on the passage and the point made."),
	reflection: z.string().describe("One question for the reader to carry."),
	imagePrompt: z
		.string()
		.nullable()
		.describe(
			"Prompt for an illustration of the setting or symbol, or null. Never depict the face of Jesus Christ. No text in the image."
		),
});

const studySchema = z.object({
	title: z.string().describe("Title of the guided study."),
	bigIdea: z.string().describe("The message in one sentence."),
	summary: z.string().describe("2-3 sentences on what was preached."),
	sections: z.array(sectionSchema).min(3).max(7),
	application: z.string().describe("2-3 sentences applying the message this week, second person."),
	prayer: z.string().describe("A short closing prayer, 2-3 sentences."),
});

const SEGMENT_INSTRUCTIONS = `You are reading the transcript of a full church service.

Only part of it is the sermon. Singing, the offering, announcements, welcomes and
the closing invitation are not the sermon and must be excluded.

Find the exact millisecond bounds of the preaching. The preacher almost always
announces the text just before beginning, for example "turn with me to Luke
chapter 9". That announcement is the start. Report bounds in milliseconds,
derived from the [h:mm:ss] marks in the transcript.`;

const COMPOSE_INSTRUCTIONS = `You write guided sermon studies for SureWord, for a
reader who could not attend the service.

You believe the King James Bible absolutely and treat it as the inerrant,
infallible word of God. Never question, soften or reinterpret it.

Two rules govern every section and neither may be broken:

1. "pastorQuote" is copied verbatim from the transcript. Never invent, tidy or
   paraphrase it. If nothing quotable covers a point, choose a different point.
2. "explanation" is SureWord's own teaching, and the reader is told as much. It
   must never be presented as something the preacher said.

Do not quote scripture in your prose. Give the reference in "passage" and it
will be rendered from the KJV text itself.

Walk the message start to finish so the reader can follow it as the service
went. Be warm, plain and specific.`;

export async function segmentService(m, cues, meta) {
	const { output } = await generateText({
		model: m,
		reasoning: "high",
		output: Output.object({ schema: segmentSchema }),
		instructions: SEGMENT_INSTRUCTIONS,
		prompt: `Service: ${meta.title}\nRecording length: ${formatTimestamp(
			cues[cues.length - 1]?.endMs ?? 0
		)}\n\nTranscript:\n${cuesToTranscript(cues)}`,
	});
	if (!output) throw new Error("The model returned no segmentation.");
	return output;
}

export async function composeStudy(m, sermonCues, meta) {
	const passage = meta.preachingText
		? lookupPassage(meta.root, meta.preachingText)
		: null;
	const passageBlock = passage
		? `\n\nThe announced text, KJV:\n${passage.verses
				.map((v) => `${v.verse}. ${v.text}`)
				.join("\n")}`
		: "";
	const { output } = await generateText({
		model: m,
		reasoning: "high",
		output: Output.object({ schema: studySchema }),
		instructions: COMPOSE_INSTRUCTIONS,
		prompt: `Service: ${meta.title}\nPreached: ${meta.preachingText ?? "not stated"}\nPreacher: ${
			meta.preacher ?? "not stated"
		}${passageBlock}\n\nSermon transcript:\n${cuesToTranscript(sermonCues)}`,
	});
	if (!output) throw new Error("The model returned no study.");
	return output;
}

/**
 * Austin's house rule is zero em and en dashes in anything an agent writes,
 * enforced mechanically rather than by asking a model nicely, because asking
 * fails perhaps one time in five. Digit ranges keep a hyphen; everywhere else
 * the dash becomes a comma, which is how the sentence would have been written.
 */
// Built from code points on purpose. Editing tools on this machine rewrite a
// literal em dash, and a \u escape for one, into a plain hyphen, which turns
// the character class below into "any hyphen" and would rewrite hyphenated
// words. Numeric escapes are the only spelling that survives a round trip.
const EM_DASH = String.fromCharCode(0x2014);
const EN_DASH = String.fromCharCode(0x2013);
const DASH_RANGE = new RegExp(`(\\d)\\s*[${EM_DASH}${EN_DASH}]\\s*(\\d)`, "g");
const DASH_PROSE = new RegExp(`\\s*[${EM_DASH}${EN_DASH}]\\s*`, "g");

export function stripDashes(text) {
	return String(text).replace(DASH_RANGE, "$1-$2").replace(DASH_PROSE, ", ");
}

function deepStrip(value) {
	if (typeof value === "string") return stripDashes(value);
	if (Array.isArray(value)) return value.map(deepStrip);
	if (value && typeof value === "object") {
		return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, deepStrip(v)]));
	}
	return value;
}

const normalizeQuote = (s) =>
	String(s ?? "")
		.replace(/[‘’]/g, "'")
		.replace(/[“”]/g, '"')
		.replace(/\s+/g, " ")
		.trim();

const words = (s) => normalizeQuote(s).toLowerCase().match(/[a-z']+/g) ?? [];

function overlapRatio(candidateWords, targetSet) {
	if (!candidateWords.length || !targetSet.size) return 0;
	const hits = candidateWords.filter((w) => targetSet.has(w)).length;
	return hits / Math.min(targetSet.size, candidateWords.length);
}

const SENTENCE_CACHE = new WeakMap();

/**
 * Cue boundaries fall mid sentence, so a quote that reads naturally almost
 * always spans two or three of them. Stitch the cues back into sentences once,
 * keeping the start time of the cue each sentence opened in.
 */
function sentencesFrom(cues) {
	const cached = SENTENCE_CACHE.get(cues);
	if (cached) return cached;
	const out = [];
	let buffer = "";
	let startMs = null;
	for (const cue of cues) {
		for (const part of cue.text.split(/(?<=[.?!])\s+/)) {
			const piece = part.trim();
			if (!piece) continue;
			if (!buffer) startMs = cue.startMs;
			buffer = buffer ? `${buffer} ${piece}` : piece;
			if (/[.?!]["')\]]?$/.test(piece)) {
				out.push({ text: buffer, startMs });
				buffer = "";
				startMs = null;
			}
		}
	}
	if (buffer) out.push({ text: buffer, startMs: startMs ?? 0 });
	SENTENCE_CACHE.set(cues, out);
	return out;
}

/** The full sentence being spoken at a timestamp, as the transcript has it. */
function sentenceAt(cues, ms) {
	if (typeof ms !== "number" || Number.isNaN(ms)) return null;
	let best = null;
	for (const sentence of sentencesFrom(cues)) {
		if (words(sentence.text).length < 5) continue;
		const distance = Math.abs(sentence.startMs - ms);
		if (!best || distance < best.distance) best = { distance, text: sentence.text };
	}
	return best && best.distance <= 30_000 ? best.text : null;
}

/**
 * A quote attributed to the preacher must be something he actually said. The
 * model paraphrases roughly one section in five however firmly the prompt
 * forbids it, so every quote is checked against the transcript: an exact match
 * stands, a near match is replaced with the real sentence from the same part
 * of the recording, and anything else loses its quote rather than putting
 * invented words in his mouth.
 */
export function verifyQuotes(
	cues,
	study,
	{ windowMs = 120_000, minOverlap = 0.6, anchorMinOverlap = 0.34 } = {}
) {
	const flat = normalizeQuote(cues.map((c) => c.text).join(" "));
	const repaired = [];
	const removed = [];
	const sections = study.sections.map((section) => {
		const quote = normalizeQuote(section.pastorQuote);
		if (quote && flat.includes(quote)) return { ...section, quoteVerified: true };

		// The model said where it was reading from. Lift the sentence out of the
		// transcript ourselves, which is verbatim by construction, and only fall
		// back to word overlap if that timestamp leads nowhere.
		const anchored = sentenceAt(cues, section.quoteAtMs ?? section.startMs);
		const target = new Set(words(quote));
		if (anchored && overlapRatio(words(anchored), target) >= anchorMinOverlap) {
			repaired.push({ heading: section.heading, was: quote, now: anchored });
			return { ...section, pastorQuote: anchored, quoteVerified: true, quoteRepaired: true };
		}

		let best = null;
		for (const cue of cues) {
			if (Math.abs(cue.startMs - section.startMs) > windowMs) continue;
			for (const sentence of cue.text.split(/(?<=[.?!])\s+/)) {
				const candidate = words(sentence);
				if (candidate.length < 6) continue;
				const overlap = overlapRatio(candidate, target);
				if (!best || overlap > best.overlap) best = { overlap, text: sentence.trim() };
			}
		}
		if (best && best.overlap >= minOverlap) {
			repaired.push({ heading: section.heading, was: quote, now: best.text });
			return { ...section, pastorQuote: best.text, quoteVerified: true, quoteRepaired: true };
		}
		removed.push({ heading: section.heading, was: quote });
		return { ...section, pastorQuote: null, quoteVerified: false };
	});
	return { sections, repaired, removed };
}

/**
 * Resolve every reference against the KJV and drop the ones that do not exist.
 * A section keeps its teaching but loses an unverifiable reference, which is
 * the honest failure: better a section with no verse than a wrong one.
 */
export function verifyStudy(root, rawStudy, cues = []) {
	const study = deepStrip(rawStudy);
	const quoteResult = cues.length
		? verifyQuotes(cues, study)
		: { sections: study.sections, repaired: [], removed: [] };
	const dropped = [];
	const sections = quoteResult.sections.map((section) => {
		if (!section.passage) return { ...section, passageText: null };
		const found = lookupPassage(root, section.passage);
		if (!found) {
			dropped.push(section.passage);
			return { ...section, passage: null, passageText: null };
		}
		return { ...section, passage: found.reference, passageText: found.verses };
	});
	return {
		...study,
		sections,
		droppedReferences: dropped,
		repairedQuotes: quoteResult.repaired,
		removedQuotes: quoteResult.removed,
	};
}

// ------------------------------------------------------------------ images

const IMAGE_STYLE =
	"Reverent painterly illustration, warm muted palette, soft dawn light, " +
	"historically grounded first-century or ancient near-eastern setting where relevant, " +
	"no lettering or text anywhere in the image, no depiction of the face of Jesus Christ.";

export async function generateImage(apiKey, prompt, outPath, { size = "1536x1024", quality = "medium" } = {}) {
	const res = await fetch("https://api.openai.com/v1/images/generations", {
		method: "POST",
		headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
		body: JSON.stringify({
			model: "gpt-image-2",
			prompt: `${prompt}\n\n${IMAGE_STYLE}`,
			size,
			quality,
			n: 1,
		}),
	});
	if (!res.ok) throw new Error(`image generation failed ${res.status}: ${(await res.text()).slice(0, 300)}`);
	const json = await res.json();
	const item = json.data?.[0];
	if (!item) throw new Error("image generation returned no data");
	const bytes = item.b64_json
		? Buffer.from(item.b64_json, "base64")
		: Buffer.from(await (await fetch(item.url)).arrayBuffer());
	fs.writeFileSync(outPath, bytes);
	return outPath;
}

// ------------------------------------------------------------------ render

/** The model sometimes labels its own teaching; the renderer owns that label. */
function stripTeachingLabel(text) {
	return String(text ?? "")
		.replace(/^\s*SureWord['’]?s teaching[:.]?\s*/i, "")
		.trim();
}

export function renderMarkdown(study, meta) {
	const url = `https://www.youtube.com/watch?v=${meta.videoId}`;
	const at = (ms) => `${url}&t=${Math.floor(ms / 1000)}s`;
	const out = [];
	out.push(`# ${study.title}`);
	out.push("");
	// The service title is only worth a line of its own when it is not simply
	// the study title again, which for a titled sermon it usually is.
	const credits = [
		normalizeQuote(meta.title) === normalizeQuote(study.title) ? null : meta.title,
		meta.preacher,
		meta.serviceDate,
	].filter(Boolean);
	if (credits.length) {
		out.push(credits.join(" · "));
		out.push("");
	}
	out.push(`*${study.bigIdea}*`);
	out.push("");
	out.push(study.summary);
	out.push("");
	const mainPassage = meta.preachingText ? lookupPassage(meta.root, meta.preachingText) : null;
	if (mainPassage) {
		out.push(`## The text: ${mainPassage.reference}`);
		out.push("");
		for (const v of mainPassage.verses) out.push(`> **${v.verse}** ${v.text}`);
		out.push("");
	}
	study.sections.forEach((section, i) => {
		out.push(`## ${i + 1}. ${section.heading}`);
		out.push("");
		out.push(`[Watch from ${formatTimestamp(section.startMs)}](${at(section.startMs)})`);
		out.push("");
		if (section.imageFile) {
			out.push(`![${section.heading}](${section.imageFile})`);
			out.push("");
		}
		if (section.pastorQuote) {
			out.push(`> ${section.pastorQuote.replace(/\n/g, " ")}`);
			out.push(`> <br>*what was preached*`);
			out.push("");
		}
		// The announced text is printed in full at the top; repeating it under a
		// section adds a screen of scrolling and tells the reader nothing new.
		if (section.passageText && section.passage !== mainPassage?.reference) {
			out.push(`**${section.passage}**`);
			out.push("");
			for (const v of section.passageText) out.push(`> **${v.verse}** ${v.text}`);
			out.push("");
		}
		out.push(`*SureWord's teaching.* ${stripTeachingLabel(section.explanation)}`);
		out.push("");
		out.push(`**Consider:** ${section.reflection}`);
		out.push("");
	});
	out.push("## This week");
	out.push("");
	out.push(study.application);
	out.push("");
	out.push("## Prayer");
	out.push("");
	out.push(study.prayer);
	out.push("");
	out.push("---");
	out.push("");
	out.push(
		`Built from [${meta.title}](${url}). Quotes are verbatim from the recording; explanations are SureWord's own teaching. Scripture is King James Version.`
	);
	const notes = [];
	if (study.droppedReferences?.length) {
		notes.push(`references dropped as unverifiable: ${study.droppedReferences.join(", ")}`);
	}
	if (study.removedQuotes?.length) {
		notes.push(
			`quotes withheld because they were not said verbatim: ${study.removedQuotes
				.map((q) => q.heading)
				.join(", ")}`
		);
	}
	if (notes.length) {
		out.push("");
		out.push(`*Editorial notes: ${notes.join("; ")}.*`);
	}
	return out.join("\n");
}
