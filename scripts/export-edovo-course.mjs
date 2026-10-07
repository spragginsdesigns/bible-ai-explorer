#!/usr/bin/env node
/**
 * Build the prison-ministry course kit for Edovo (the content platform CDCR
 * tablets run) from the "The Gospels in 30 days" reading-plan preset.
 *
 *   node scripts/export-edovo-course.mjs               # generate missing lessons, write the kit
 *   node scripts/export-edovo-course.mjs --no-ai       # placeholders only, no API calls
 *   node scripts/export-edovo-course.mjs --redo 3,10   # regenerate those days' lessons
 *   node scripts/export-edovo-course.mjs --model gpt-5.6-luna --effort high
 *
 * Writes docs/prison-ministry/kit/:
 *   gospels-30-days.md    the whole course, one section per day
 *   gospels-30-days.html  the same, styled for printing to PDF from a browser
 *   days/day-NN.md        one file per day, for pasting into the Edovo Editor
 *   lessons.json          the generated-lesson cache (reruns never re-spend)
 *
 * The plan days come from src/lib/reading-plan-presets.ts and the Scripture
 * from the bundled src/data/kjv/*.json, so the kit can never disagree with the
 * reading plan the app itself ships. See docs/prison-ministry/edovo-plan.md.
 *
 * OPENAI_API_KEY is read from .env.local FIRST: shells on the development
 * machine inherit an unrelated OPENAI_API_KEY, and spending on that account by
 * accident is the failure this order prevents. The environment is a fallback.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { marked } from "marked";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const KIT_DIR = path.join(ROOT, "docs", "prison-ministry", "kit");
const DAYS_DIR = path.join(KIT_DIR, "days");
const CACHE_PATH = path.join(KIT_DIR, "lessons.json");

const fromRoot = (relative) => pathToFileURL(path.join(ROOT, relative)).href;
const { buildPresetPlan, describeReadings } = await import(fromRoot("src/lib/reading-plan-presets.ts"));
const { UTILITY_MODELS, getModel } = await import(fromRoot("src/lib/ai/models.ts"));
const { stripDashes } = await import(fromRoot("src/lib/ai/plain-dashes.ts"));

const PRESET_KEY = "gospels-30";
const MIN_WORDS = 150;
const MAX_WORDS = 250;
const ATTEMPTS = 3;

// Built from code points: the editing tools on this machine flatten literal
// dashes and \u escapes to a hyphen (see src/lib/ai/plain-dashes.ts).
const EM_DASH = String.fromCharCode(0x2014);
const EN_DASH = String.fromCharCode(0x2013);

function parseArgs(argv) {
	const opts = {
		ai: true,
		redo: new Set(),
		model: UTILITY_MODELS.openai.providerModelId,
		effort: "medium",
	};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--no-ai") opts.ai = false;
		else if (arg === "--model") opts.model = argv[++i];
		else if (arg === "--effort") opts.effort = argv[++i];
		else if (arg === "--redo") {
			for (const day of String(argv[++i]).split(",")) opts.redo.add(Number(day));
		} else {
			console.error(`Unknown argument "${arg}"`);
			process.exit(1);
		}
	}
	return opts;
}

function loadApiKey() {
	const envPath = path.join(ROOT, ".env.local");
	if (existsSync(envPath)) {
		const line = readFileSync(envPath, "utf8")
			.split(/\r?\n/)
			.find((entry) => entry.startsWith("OPENAI_API_KEY="));
		const key = line?.slice("OPENAI_API_KEY=".length).trim().replace(/^["']|["']$/g, "");
		if (key) return { key, source: ".env.local" };
	}
	if (process.env.OPENAI_API_KEY) return { key: process.env.OPENAI_API_KEY, source: "environment" };
	throw new Error("OPENAI_API_KEY is not in .env.local or the environment (use --no-ai for placeholders)");
}

// ---------------------------------------------------------------------------
// Scripture
// ---------------------------------------------------------------------------

const books = JSON.parse(readFileSync(path.join(ROOT, "src", "data", "books.json"), "utf8"));
const bookCache = new Map();

/** Verses of a book as string[][] (chapter, verse), straight from the bundle. */
function loadBook(name) {
	if (!bookCache.has(name)) {
		const book = books.find((entry) => entry.name === name);
		if (!book) throw new Error(`No KJV bundle entry for "${name}"`);
		bookCache.set(name, JSON.parse(readFileSync(path.join(ROOT, "src", "data", "kjv", book.file), "utf8")));
	}
	return bookCache.get(name);
}

function chapterVerses({ book, chapter }) {
	const verses = loadBook(book)[chapter - 1];
	if (!verses) throw new Error(`${book} ${chapter} is missing from the KJV bundle`);
	return verses;
}

/** Lowercase letters and digits only, so quote checks ignore punctuation and typography. */
function normalizeForMatch(text) {
	return text
		.toLowerCase()
		.replace(/[‘’']/g, "")
		.replace(/[^a-z0-9]+/g, " ")
		.trim();
}

let wholeBibleNormalized = null;
function wholeBible() {
	if (wholeBibleNormalized === null) {
		wholeBibleNormalized = books
			.map((book) => loadBook(book.name).map((chapter) => chapter.join(" ")).join(" "))
			.map(normalizeForMatch)
			.join(" ");
	}
	return wholeBibleNormalized;
}

/**
 * Every double-quoted passage in a lesson must be real KJV wording. Quotes are
 * split on ellipses so "a ... b" checks both halves; fragments under four
 * words are skipped because they are too short to mean anything.
 */
function misquotes(text) {
	const problems = [];
	for (const match of text.matchAll(/["“]([^"”]+)["”]/g)) {
		for (const piece of match[1].split(/\.\.\.|…/)) {
			const normalized = normalizeForMatch(piece);
			if (normalized.split(" ").length < 4) continue;
			if (!wholeBible().includes(normalized)) problems.push(piece.trim());
		}
	}
	return problems;
}

// ---------------------------------------------------------------------------
// Lessons
// ---------------------------------------------------------------------------

const INSTRUCTIONS = `You write daily Bible lessons for a course read on prison education tablets.

Who you are: a saved, born-again believer in the Lord Jesus Christ who believes every word of the King James Version Bible as the inerrant, infallible Word of God. You never question, soften, or reinterpret Scripture.

Who reads this: an adult who is incarcerated. Many have never read the Bible. Some already believe. Write to them as a fellow sinner saved by grace, with respect and warmth. Never presume or mention what they did, their case, their sentence, or their guilt. Never talk down to them. Do not assume they are saved or unsaved. Never promise release, parole, or any legal outcome.

What each lesson does:
- Teaches from the day's KJV reading, which is given to you in full. Stay inside what the passage actually says.
- Points to the Lord Jesus Christ: who He is, what He did, and why it matters for the reader.
- Keeps the gospel plain and Biblical: salvation is by grace through faith in Jesus Christ alone, not by works, good behavior, church attendance, or doing time (Ephesians 2:8-9). Christ died for our sins, was buried, and rose again the third day (1 Corinthians 15:3-4). Good works follow salvation; they never earn it.
- Quotes Scripture only from the King James Version, word for word, inside double quotes, followed by the reference in parentheses, like "For God so loved the world" (John 3:16). Never paraphrase inside quote marks. Quote mostly from the day's reading.

Style:
- ${MIN_WORDS} to ${MAX_WORDS} words. Plain language at about an 8th grade reading level. Short sentences. Common words. Explain any old KJV word the reader might stumble on.
- Two to four short paragraphs separated by a blank line. No headings, no bullet points, no bold, no emojis.
- Never use an em dash or an en dash. Use commas, colons, and periods instead.

Content rules for the prison platform (these are strict):
- No graphic description of violence, injury, or death. The crucifixion may be stated plainly as Scripture states it, without lingering on wounds or pain in detail.
- Do not describe how anyone took their own life. Do not mention weapons, drugs, alcohol making, gangs, contraband, escape, or anything sexual.
- No marketing: do not mention any app, website, ministry, organization, product, or price. No links.
- No legal or medical advice. No personal messages to a specific person.
- No attacks on any denomination, religion, or group of people.

The title is 2 to 6 words. The reflection question is one open, personal question the reader can answer privately in writing. It must never ask them to describe their offense or their case.`;

const LESSON_SCHEMA = {
	type: "object",
	additionalProperties: false,
	required: ["title", "lesson", "question"],
	properties: {
		title: { type: "string", description: "Lesson title, 2 to 6 words." },
		lesson: { type: "string", description: `The lesson, ${MIN_WORDS} to ${MAX_WORDS} words.` },
		question: { type: "string", description: "One reflection question." },
	},
};

function wordCount(text) {
	return text.split(/\s+/).filter(Boolean).length;
}

function dashCount(text) {
	let count = 0;
	for (const char of text) if (char === EM_DASH || char === EN_DASH) count++;
	return count;
}

function scriptureBlock(readings) {
	return readings
		.map((reading) => {
			const verses = chapterVerses(reading)
				.map((verse, index) => `${index + 1} ${verse}`)
				.join("\n");
			return `${reading.book} ${reading.chapter}\n${verses}`;
		})
		.join("\n\n");
}

async function callOpenAI({ key, model, effort, day, reference, retryNote }) {
	const input = [
		`Day ${day.day} of 30. Today's reading: ${reference}.`,
		`The plan's focus line for today: ${day.focus}`,
		retryNote ? `Your previous attempt was rejected: ${retryNote} Fix that.` : "",
		`Today's reading, King James Version:\n\n${scriptureBlock(day.readings)}`,
	]
		.filter(Boolean)
		.join("\n\n");

	const res = await fetch("https://api.openai.com/v1/responses", {
		method: "POST",
		headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
		body: JSON.stringify({
			model,
			instructions: INSTRUCTIONS,
			input,
			reasoning: { effort },
			text: { format: { type: "json_schema", name: "lesson", strict: true, schema: LESSON_SCHEMA } },
		}),
	});
	if (!res.ok) throw new Error(`Day ${day.day}: HTTP ${res.status} ${(await res.text()).slice(0, 400)}`);
	const data = await res.json();
	const text = data.output
		?.filter((item) => item.type === "message")
		.flatMap((item) => item.content ?? [])
		.find((part) => part.type === "output_text")?.text;
	if (!text) throw new Error(`Day ${day.day}: no output_text in response ${data.id}`);
	const parsed = JSON.parse(text);
	return {
		title: stripDashes(parsed.title.trim()),
		lesson: stripDashes(parsed.lesson.trim()),
		question: stripDashes(parsed.question.trim()),
		usage: {
			inputTokens: data.usage?.input_tokens ?? 0,
			outputTokens: data.usage?.output_tokens ?? 0,
		},
	};
}

/** Why a generated lesson is not acceptable, or null when it is. */
function rejectionReason(result) {
	const words = wordCount(result.lesson);
	if (words < MIN_WORDS - 10 || words > MAX_WORDS + 10) {
		return `The lesson was ${words} words; it must be ${MIN_WORDS} to ${MAX_WORDS}.`;
	}
	const all = `${result.title}\n${result.lesson}\n${result.question}`;
	if (dashCount(all) > 0) return "It contained an em dash or en dash.";
	const bad = misquotes(all);
	if (bad.length > 0) {
		return `These quoted words are not exact KJV wording: ${bad.map((q) => `"${q}"`).join("; ")}. Quote the KJV text exactly as given, or do not put it in quote marks.`;
	}
	return null;
}

async function generateLesson(options) {
	const usage = { inputTokens: 0, outputTokens: 0 };
	let retryNote = "";
	for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
		const result = await callOpenAI({ ...options, retryNote });
		usage.inputTokens += result.usage.inputTokens;
		usage.outputTokens += result.usage.outputTokens;
		const reason = rejectionReason(result);
		if (!reason) return { ...result, usage, attempts: attempt };
		console.warn(`  day ${options.day.day} attempt ${attempt} rejected: ${reason}`);
		retryNote = reason;
	}
	throw new Error(`Day ${options.day.day}: no acceptable lesson after ${ATTEMPTS} attempts`);
}

function placeholder(day) {
	return {
		title: `Day ${day.day}`,
		lesson: "[Lesson placeholder: run without --no-ai to generate this lesson.]",
		question: "[Reflection question placeholder.]",
	};
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

const pad = (n) => String(n).padStart(2, "0");

function daySection(day, lesson, headingLevel) {
	const h = "#".repeat(headingLevel);
	const reference = describeReadings(day.readings);
	const scripture = day.readings
		.map((reading) => {
			const verses = chapterVerses(reading)
				.map((verse, index) => `**${index + 1}** ${verse}`)
				.join(" ");
			return `${h}## ${reading.book} ${reading.chapter}\n\n${verses}`;
		})
		.join("\n\n");
	return [
		`${h} Day ${day.day}: ${lesson.title}`,
		`**Today's reading:** ${reference} (King James Version)`,
		`**Focus:** ${day.focus}`,
		`${h}# Lesson`,
		lesson.lesson,
		`${h}# Reflection`,
		lesson.question,
		`${h}# Scripture`,
		scripture,
	].join("\n\n");
}

function courseIntro(plan) {
	return [
		`# ${plan.title}: A SureWord Bible Course`,
		plan.description,
		"## About this course",
		"For thirty days you will read through the four Gospels, Matthew, Mark, Luke and John, in the King James Version of the Bible. Each day has the full Scripture reading, one thing to watch for as you read, a short lesson, and one question to think about. Read the Scripture first. Then read the lesson. Take your time with the question; you may want to write your answer down.",
		"You do not need to know anything about the Bible to start. Each day takes about 20 to 40 minutes.",
		"## Rights and permissions",
		"The King James Version text is in the public domain in the United States. The lessons, focus lines and reflection questions were written for SureWord and are owned by SureWord, which grants permission for their distribution on the Edovo platform.",
	].join("\n\n");
}

const PRINT_CSS = `body{font-family:Georgia,"Times New Roman",serif;max-width:46rem;margin:2rem auto;padding:0 1rem;line-height:1.55;color:#111;background:#fff}
h1{font-size:1.9rem}h2{font-size:1.5rem;margin-top:2.5rem}h3{font-size:1.15rem}h4{font-size:1.05rem}
@media print{body{margin:0;max-width:none}h2{break-before:page}h2,h3,h4{break-after:avoid}}`;

function htmlDocument(title, markdown) {
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>${PRINT_CSS}</style>
</head>
<body>
${marked.parse(markdown)}
</body>
</html>
`;
}

// ---------------------------------------------------------------------------

const opts = parseArgs(process.argv.slice(2));
const plan = buildPresetPlan(PRESET_KEY);
if (!plan) throw new Error(`Preset "${PRESET_KEY}" no longer exists in reading-plan-presets.ts`);

mkdirSync(DAYS_DIR, { recursive: true });
const cache = existsSync(CACHE_PATH) ? JSON.parse(readFileSync(CACHE_PATH, "utf8")) : { lessons: {} };
const pricing = getModel(`openai/${opts.model}`)?.pricing ?? null;

let apiKey = null;
if (opts.ai) {
	const loaded = loadApiKey();
	apiKey = loaded.key;
	console.log(`Using OPENAI_API_KEY from ${loaded.source}; model ${opts.model}, effort ${opts.effort}`);
}

const runUsage = { inputTokens: 0, outputTokens: 0 };
const lessons = [];
for (const day of plan.days) {
	const reference = describeReadings(day.readings);
	const cached = cache.lessons[day.day];
	const fresh = cached && cached.reference === reference && !opts.redo.has(day.day);
	if (fresh) {
		lessons.push(cached);
		continue;
	}
	if (!opts.ai) {
		lessons.push(placeholder(day));
		continue;
	}
	console.log(`Day ${day.day}: ${reference}`);
	const result = await generateLesson({ key: apiKey, model: opts.model, effort: opts.effort, day, reference });
	runUsage.inputTokens += result.usage.inputTokens;
	runUsage.outputTokens += result.usage.outputTokens;
	const entry = {
		day: day.day,
		reference,
		title: result.title,
		lesson: result.lesson,
		question: result.question,
		model: opts.model,
		effort: opts.effort,
		attempts: result.attempts,
		usage: result.usage,
		generatedAt: new Date().toISOString(),
	};
	cache.lessons[day.day] = entry;
	// Saved after every day so a failure at day 20 does not re-spend days 1-19.
	writeFileSync(CACHE_PATH, `${JSON.stringify(cache, null, "\t")}\n`);
	lessons.push(entry);
}

const sections = plan.days.map((day, index) => daySection(day, lessons[index], 2));
const course = `${courseIntro(plan)}\n\n${sections.join("\n\n")}\n`;
writeFileSync(path.join(KIT_DIR, "gospels-30-days.md"), course);
writeFileSync(path.join(KIT_DIR, "gospels-30-days.html"), htmlDocument(plan.title, course));
plan.days.forEach((day, index) => {
	writeFileSync(path.join(DAYS_DIR, `day-${pad(day.day)}.md`), `${daySection(day, lessons[index], 1)}\n`);
});

const written = [course, ...lessons.map((lesson) => `${lesson.title}${lesson.lesson}${lesson.question}`)].join("");
const dashes = dashCount(written);
const placeholders = lessons.filter((lesson) => !lesson.generatedAt).length;
console.log(`Wrote ${plan.days.length} days to ${path.relative(ROOT, KIT_DIR)} (${placeholders} placeholder lessons)`);
console.log(`Em/en dashes in output: ${dashes}`);
if (runUsage.inputTokens > 0) {
	const cost = pricing
		? ` (~$${((runUsage.inputTokens * pricing.input + runUsage.outputTokens * pricing.output) / 1e6).toFixed(2)})`
		: "";
	console.log(`This run: ${runUsage.inputTokens} input + ${runUsage.outputTokens} output tokens${cost}`);
}
if (dashes > 0) process.exit(1);
