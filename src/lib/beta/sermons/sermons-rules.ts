/**
 * Pure rules for Sermon to Study (LC-17643, docs/beta/sermons.md): how a
 * spoken reference is read out of a transcript, how a quotation is matched
 * against the bundled KJV, and what makes a generated study safe to show. No
 * imports, so `tests/beta-sermons.test.mjs` loads it with Node's type
 * stripping; the server passes in `resolveReference` and the KJV verses.
 *
 * The editorial rule the whole module keeps: the sermon's words and Scripture
 * are never mixed. A passage's text always comes from the bundled KJV, a
 * "the preacher said" quote must be found verbatim in the transcript, and
 * everything the model writes is labelled as SureWord's study.
 */

export const SERMONS_MODULE = "sermons";

/** The longest recording one sermon takes, in seconds. */
export const SERMON_MAX_SECONDS = 90 * 60;
/** The browser cuts the audio into pieces of at most this many seconds. */
export const CHUNK_MAX_SECONDS = 110;
/** 16 kHz, mono, 16-bit PCM: what the browser sends and the server checks. */
export const CHUNK_SAMPLE_RATE = 16_000;
export const WAV_HEADER_BYTES = 44;
export const SERMON_TITLE_MAX = 120;
export const SERMON_PREACHER_MAX = 80;
/** Saved sermons a founder keeps at once. */
export const SERMONS_MAX = 60;

export type SermonStatus = "transcribing" | "ready";

export interface TranscriptSegment {
	/** Seconds from the start of the recording. */
	start: number;
	end: number;
	text: string;
}

export interface PassageRef {
	book: number;
	chapter: number;
	verse?: number;
}

export type PassageHow = "named" | "quoted";

export interface SermonPassage {
	/** The store's passage key: "47.4.7" or "45.5". */
	key: string;
	book: number;
	chapter: number;
	verse: number | null;
	/** How the sermon brought it in: named aloud, or quoted in the KJV's words. */
	how: PassageHow;
	/** Seconds into the recording where it first comes up. */
	at: number;
	/** Every moment it comes up, first one first (at most 8). */
	times: number[];
}

export interface StudySection {
	heading: string;
	startSec: number;
	/** Verbatim from the transcript, or null when the model's quote was not found there. */
	pastorQuote: string | null;
	/** A reference like "2 Corinthians 4:7", resolved; the text comes from the KJV. */
	passage: string | null;
	explanation: string;
	reflection: string;
}

export interface SermonStudyNotes {
	bigIdea: string;
	summary: string;
	sections: StudySection[];
	application: string;
	questions: string[];
	/** Passage keys from the sermon's own passages, offered to Learn a verse. */
	memory: string[];
	model: string;
	createdAt: string;
}

export type ContextFit = "close" | "applies" | "beyond";

export interface PassageComparison {
	key: string;
	/** What the passage says where it stands, Scripture first. */
	context: string;
	/** How the sermon used it. */
	sermonUse: string;
	fit: ContextFit;
	fitNote: string;
	/** Questions worth weighing, which the founder can mark for later research. */
	questions: string[];
	model: string;
	createdAt: string;
}

export interface SermonData {
	status: SermonStatus;
	preacher: string | null;
	/** The founder confirmed they may use this recording, and when. */
	permissionAt: string;
	source: "upload" | "recording";
	fileName: string | null;
	durationSec: number;
	/** Seconds of each transcribed piece, in order. */
	parts: number[];
	segments: TranscriptSegment[];
	passages: SermonPassage[];
	study: SermonStudyNotes | null;
	comparisons: PassageComparison[];
	/** Questions marked for later research, in the order they were marked. */
	research: string[];
}

/* -------------------------------------------------------------------------
 * Clock
 * ---------------------------------------------------------------------- */

/** "12:07", or "1:02:44" past the hour. */
export function formatClock(seconds: number): string {
	const total = Math.max(0, Math.floor(seconds));
	const hours = Math.floor(total / 3600);
	const minutes = Math.floor((total % 3600) / 60);
	const secs = String(total % 60).padStart(2, "0");
	return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${secs}` : `${minutes}:${secs}`;
}

/* -------------------------------------------------------------------------
 * Audio pieces
 * ---------------------------------------------------------------------- */

/** Seconds of 16 kHz mono 16-bit audio in a WAV of this many bytes. */
export function wavSeconds(byteLength: number): number {
	return Math.max(0, byteLength - WAV_HEADER_BYTES) / (CHUNK_SAMPLE_RATE * 2);
}

/**
 * Whether a WAV header is the exact shape the browser produces (RIFF/WAVE,
 * PCM, one channel, 16 kHz, 16-bit). Anything else is refused before any
 * paid transcription.
 */
export function isSermonWav(header: Uint8Array): boolean {
	if (header.length < WAV_HEADER_BYTES) return false;
	const text = (from: number, length: number) => String.fromCharCode(...header.subarray(from, from + length));
	const u16 = (at: number) => header[at] | (header[at + 1] << 8);
	const u32 = (at: number) => (header[at] | (header[at + 1] << 8) | (header[at + 2] << 16) | (header[at + 3] << 24)) >>> 0;
	return (
		text(0, 4) === "RIFF" &&
		text(8, 4) === "WAVE" &&
		text(12, 4) === "fmt " &&
		u16(20) === 1 &&
		u16(22) === 1 &&
		u32(24) === CHUNK_SAMPLE_RATE &&
		u16(34) === 16 &&
		text(36, 4) === "data"
	);
}

/** The next piece's place in the recording, from the pieces already transcribed. */
export function pieceOffset(parts: readonly number[]): number {
	return parts.reduce((sum, seconds) => sum + seconds, 0);
}

/** Shift one piece's segments onto the whole recording's clock, dropping empty ones. */
export function placeSegments(segments: readonly { text: string; startSecond: number; endSecond: number }[], offset: number): TranscriptSegment[] {
	const round = (value: number) => Math.round(value * 10) / 10;
	return segments
		.map((segment) => ({ start: round(offset + segment.startSecond), end: round(offset + segment.endSecond), text: segment.text.replace(/\s+/g, " ").trim() }))
		.filter((segment) => segment.text.length > 0);
}

/* -------------------------------------------------------------------------
 * Spoken references
 * ---------------------------------------------------------------------- */

export interface SpokenReference extends PassageRef {
	at: number;
	/** The words as spoken, like "Second Corinthians chapter 4 verse 7". */
	spoken: string;
}

const ORDINALS: Record<string, string> = { first: "1", "1st": "1", "1": "1", i: "1", second: "2", "2nd": "2", "2": "2", ii: "2", third: "3", "3rd": "3", "3": "3", iii: "3" };
const NUMBER_WORDS: Record<string, number> = {
	one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
	thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
};
const NUMBER = `(\\d{1,3}|${Object.keys(NUMBER_WORDS).join("|")})`;

function readNumber(token: string | undefined): number | undefined {
	if (!token) return undefined;
	const lower = token.toLowerCase();
	return /^\d+$/.test(lower) ? Number(lower) : NUMBER_WORDS[lower];
}

function escapeForPattern(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The pattern for a spoken reference: an optional ordinal ("Second",
 * "2nd", "2"), a capitalised book name, then a chapter ("4", "chapter
 * four") and an optional verse ("4:7", "4.7", "verse 7", ", verse seven",
 * "4, 7").
 * Book names are matched as written so "acts" or "mark" in a sentence are not
 * read as books; a book with no chapter after it is not a reference.
 */
export function spokenReferencePattern(bookNames: readonly string[]): RegExp {
	const bases = [...new Set(bookNames.map((name) => name.replace(/^[1-3]\s+/, "")))].sort((a, b) => b.length - a.length);
	const books = bases.map(escapeForPattern).join("|");
	const ordinal = "(?:\\b(First|Second|Third|first|second|third|1st|2nd|3rd|[123]|III|II|I)\\s+)?";
	const chapter = `(?:\\s+chapter|\\s*,?\\s+chapter)?\\s+${NUMBER}\\b`;
	// "4:7", "4.7", "4, verse 7" and Whisper's "4, 7" for a spoken "four seven".
	const verse = `(?:\\s*[:.]\\s?(\\d{1,3})\\b|\\s*,?\\s+(?:and\\s+)?(?:verses?|v\\.)\\s+${NUMBER}\\b|\\s*,\\s?(\\d{1,3})\\b)?`;
	return new RegExp(`${ordinal}\\b(${books})${chapter}${verse}`, "g");
}

/**
 * Every explicit reference in the transcript, each resolved with the app's
 * own `resolveReference` (so "Psalm 23" and "Ps 23" behave as they do in the
 * reader). A numbered book needs its number ("Second Corinthians"); without
 * it the reference is ambiguous and skipped.
 */
export function findSpokenReferences(
	segments: readonly TranscriptSegment[],
	bookNames: readonly string[],
	resolve: (reference: string) => { order: number; chapter: number; verse?: number } | null,
): SpokenReference[] {
	const pattern = spokenReferencePattern(bookNames);
	const found: SpokenReference[] = [];
	for (const segment of segments) {
		pattern.lastIndex = 0;
		for (let match = pattern.exec(segment.text); match; match = pattern.exec(segment.text)) {
			const [spoken, ordinal, book, chapterToken, colonVerse, wordVerse, commaVerse] = match;
			const prefix = ordinal ? ORDINALS[ordinal.toLowerCase()] : undefined;
			const chapterNumber = readNumber(chapterToken);
			const verseNumber = readNumber(colonVerse ?? wordVerse ?? commaVerse);
			if (!chapterNumber) continue;
			const reference = `${prefix ? `${prefix} ` : ""}${book} ${chapterNumber}${verseNumber ? `:${verseNumber}` : ""}`;
			const resolved = resolve(reference);
			if (!resolved) continue;
			found.push({ book: resolved.order, chapter: resolved.chapter, verse: resolved.verse, at: segment.start, spoken: spoken.trim() });
		}
	}
	return found;
}

/* -------------------------------------------------------------------------
 * Quotations of the KJV
 * ---------------------------------------------------------------------- */

/** Words as compared: lowercase letters only, "Beth-el" as "bethel", "ye" kept. */
export function foldWords(text: string): string[] {
	return text
		.toLowerCase()
		.replace(/[‘’']/g, "")
		.replace(/(\p{L})-(?=\p{L})/gu, "$1")
		.replace(/[^\p{L}\s]+/gu, " ")
		.split(/\s+/)
		.filter(Boolean);
}

export const SHINGLE = 4;
/** A run of words shared by more verses than this ("and it came to pass") proves nothing. */
const COMMON_SHINGLE_VERSES = 6;

export interface KjvVerse {
	book: number;
	chapter: number;
	verse: number;
	text: string;
}

export interface Quotation extends PassageRef {
	verse: number;
	at: number;
	/** Every separate place it is quoted, first one first. */
	times: number[];
	/** Distinct runs of four words shared with the verse in its best place. */
	matched: number;
}

/** A quotation's runs must be heard within this many seconds of each other. */
const QUOTE_WINDOW_SECONDS = 60;

/**
 * Verses the sermon quotes in the KJV's words. Every run of four words in the
 * transcript is looked up in every verse; a verse counts as quoted where at
 * least two of its runs are heard within a minute of each other and they
 * cover half the verse (or six runs of a long verse), not counting runs so
 * common in Scripture that they could belong to any of several verses. Runs
 * scattered across a long sermon do not add up. Paraphrase does not count:
 * this finds what was read aloud, and the named references cover the rest.
 */
export function findQuotations(segments: readonly TranscriptSegment[], verses: Iterable<KjvVerse>): Quotation[] {
	const words: { word: string; at: number }[] = [];
	for (const segment of segments) for (const word of foldWords(segment.text)) words.push({ word, at: segment.start });
	const heard = new Map<string, number[]>();
	for (let i = 0; i + SHINGLE <= words.length; i += 1) {
		const run = words.slice(i, i + SHINGLE).map((entry) => entry.word).join(" ");
		const times = heard.get(run);
		if (!times) heard.set(run, [words[i].at]);
		else if (times[times.length - 1] !== words[i].at) times.push(words[i].at);
	}
	if (heard.size === 0) return [];

	const versesWith = new Map<string, number>();
	const candidates: { verse: KjvVerse; runs: string[]; total: number }[] = [];
	for (const verse of verses) {
		const folded = foldWords(verse.text);
		const total = Math.max(1, folded.length - SHINGLE + 1);
		const runs = new Set<string>();
		for (let i = 0; i + SHINGLE <= folded.length; i += 1) {
			const run = folded.slice(i, i + SHINGLE).join(" ");
			if (heard.has(run) && !runs.has(run)) {
				runs.add(run);
				versesWith.set(run, (versesWith.get(run) ?? 0) + 1);
			}
		}
		if (runs.size >= 2) candidates.push({ verse, runs: [...runs], total });
	}

	const quotations: Quotation[] = [];
	for (const { verse, runs, total } of candidates) {
		const telling = runs.filter((run) => (versesWith.get(run) ?? 0) <= COMMON_SHINGLE_VERSES);
		if (telling.length < 2) continue;
		// Each place the verse is heard: runs within a minute of the first run of that place.
		const heardAt = telling.flatMap((run) => (heard.get(run) ?? []).map((at) => ({ run, at }))).sort((a, b) => a.at - b.at);
		const places: { at: number; runs: Set<string> }[] = [];
		for (const entry of heardAt) {
			const place = places[places.length - 1];
			if (place && entry.at - place.at <= QUOTE_WINDOW_SECONDS) place.runs.add(entry.run);
			else places.push({ at: entry.at, runs: new Set([entry.run]) });
		}
		const quoted = places.filter((place) => place.runs.size >= 2 && (place.runs.size / total >= 0.5 || place.runs.size >= 6));
		if (quoted.length === 0) continue;
		const best = Math.max(...quoted.map((place) => place.runs.size));
		quotations.push({ book: verse.book, chapter: verse.chapter, verse: verse.verse, at: quoted[0].at, times: quoted.map((place) => place.at), matched: best });
	}
	return quotations.sort((a, b) => a.at - b.at);
}

/* -------------------------------------------------------------------------
 * Passages
 * ---------------------------------------------------------------------- */

export function passageKey(ref: PassageRef): string {
	return ref.verse === undefined ? `${ref.book}.${ref.chapter}` : `${ref.book}.${ref.chapter}.${ref.verse}`;
}

const MAX_TIMES = 8;

/**
 * One entry per passage, in the order the sermon reaches it. A verse both
 * named and quoted is "named" (the preacher pointed at it); a chapter named
 * on its own stays a chapter unless a verse in it was also found, in which
 * case the verse carries it.
 */
export function mergePassages(named: readonly SpokenReference[], quoted: readonly Quotation[]): SermonPassage[] {
	const byKey = new Map<string, SermonPassage>();
	const add = (ref: PassageRef & { at: number }, how: PassageHow) => {
		const key = passageKey(ref);
		const existing = byKey.get(key);
		if (existing) {
			if (how === "named") existing.how = "named";
			if (!existing.times.some((time) => Math.abs(time - ref.at) < 20) && existing.times.length < MAX_TIMES) existing.times.push(ref.at);
			existing.times.sort((a, b) => a - b);
			existing.at = existing.times[0];
			return;
		}
		byKey.set(key, { key, book: ref.book, chapter: ref.chapter, verse: ref.verse ?? null, how, at: ref.at, times: [ref.at] });
	};
	for (const ref of named) add(ref, "named");
	for (const ref of quoted) for (const at of ref.times) add({ ...ref, at }, "quoted");
	const verseChapters = new Set([...byKey.values()].filter((p) => p.verse !== null).map((p) => `${p.book}.${p.chapter}`));
	return [...byKey.values()]
		.filter((passage) => passage.verse !== null || !verseChapters.has(passage.key))
		.sort((a, b) => a.at - b.at || a.book - b.book || a.chapter - b.chapter || (a.verse ?? 0) - (b.verse ?? 0));
}

/** Store keys for the item: each verse key brings its chapter key. */
export function passageRefKeys(passages: readonly SermonPassage[]): string[] {
	const keys = new Set<string>();
	for (const passage of passages) {
		keys.add(`${passage.book}.${passage.chapter}`);
		if (passage.verse !== null) keys.add(passage.key);
	}
	return [...keys].slice(0, 500);
}

/** The transcript around a moment: the segments within `radius` seconds of it. */
export function excerptAround(segments: readonly TranscriptSegment[], at: number, radius = 25): string {
	return segments
		.filter((segment) => segment.end >= at - radius && segment.start <= at + radius)
		.map((segment) => segment.text)
		.join(" ")
		.trim();
}

/* -------------------------------------------------------------------------
 * Generated study
 * ---------------------------------------------------------------------- */

export interface StudyDraft {
	bigIdea: string;
	summary: string;
	sections: { heading: string; minute: number; pastorQuote: string | null; passage: string | null; explanation: string; reflection: string }[];
	application: string;
	questions: string[];
	memory: string[];
}

export const STUDY_LIMITS = { bigIdea: 300, summary: 1200, heading: 90, quote: 400, explanation: 900, reflection: 300, application: 900, question: 300, sections: 8, questions: 10, memory: 4 };

const clip = (text: string, max: number) => {
	const plain = text.replace(/\s+/g, " ").trim();
	return plain.length <= max ? plain : `${plain.slice(0, max - 1).trimEnd()}…`;
};

/** Whether `quote` occurs, word for word, in the transcript (case and punctuation aside). */
export function quoteIsVerbatim(quote: string, transcript: string): boolean {
	const words = foldWords(quote);
	if (words.length < 4) return false;
	return ` ${foldWords(transcript).join(" ")} `.includes(` ${words.join(" ")} `);
}

/**
 * Hold a generated study to the module's rules. A section's quote is kept
 * only when it is verbatim in the transcript; a passage only when it
 * resolves; a memory verse only when it is one of the sermon's own verse-level
 * passages. A study with no big idea or no sections is refused.
 */
export function checkStudyDraft(
	draft: StudyDraft,
	input: { transcript: string; durationSec: number; passages: readonly SermonPassage[]; resolve: (reference: string) => PassageRef | null; model: string; now: string },
): SermonStudyNotes | { error: string } {
	const bigIdea = clip(draft.bigIdea ?? "", STUDY_LIMITS.bigIdea);
	if (!bigIdea) return { error: "no big idea" };
	const sections: StudySection[] = [];
	for (const section of draft.sections ?? []) {
		const heading = clip(section.heading ?? "", STUDY_LIMITS.heading);
		const explanation = clip(section.explanation ?? "", STUDY_LIMITS.explanation);
		if (!heading || !explanation) continue;
		const quote = section.pastorQuote ? clip(section.pastorQuote.replace(/^["“]|["”]$/g, ""), STUDY_LIMITS.quote) : null;
		const resolved = section.passage ? input.resolve(section.passage) : null;
		const minute = Number.isFinite(section.minute) ? Math.max(0, section.minute) : 0;
		sections.push({
			heading,
			startSec: Math.min(Math.round(minute * 60), Math.max(0, Math.floor(input.durationSec))),
			pastorQuote: quote && quoteIsVerbatim(quote, input.transcript) ? quote : null,
			passage: resolved && section.passage ? section.passage.trim() : null,
			explanation,
			reflection: clip(section.reflection ?? "", STUDY_LIMITS.reflection),
		});
		if (sections.length >= STUDY_LIMITS.sections) break;
	}
	if (sections.length === 0) return { error: "no sections" };
	sections.sort((a, b) => a.startSec - b.startSec);
	const own = new Set(input.passages.filter((passage) => passage.verse !== null).map((passage) => passage.key));
	const memory: string[] = [];
	for (const reference of draft.memory ?? []) {
		const resolved = input.resolve(reference);
		if (!resolved || resolved.verse === undefined) continue;
		const key = passageKey(resolved);
		if (own.has(key) && !memory.includes(key)) memory.push(key);
		if (memory.length >= STUDY_LIMITS.memory) break;
	}
	const questions = [...new Set((draft.questions ?? []).map((question) => clip(question ?? "", STUDY_LIMITS.question)).filter(Boolean))].slice(0, STUDY_LIMITS.questions);
	return {
		bigIdea,
		summary: clip(draft.summary ?? "", STUDY_LIMITS.summary),
		sections,
		application: clip(draft.application ?? "", STUDY_LIMITS.application),
		questions,
		memory,
		model: input.model,
		createdAt: input.now,
	};
}

export interface ComparisonDraft {
	context: string;
	sermonUse: string;
	fit: ContextFit;
	fitNote: string;
	questions: string[];
}

export function checkComparisonDraft(draft: ComparisonDraft, key: string, model: string, now: string): PassageComparison | { error: string } {
	const context = clip(draft.context ?? "", 1400);
	const sermonUse = clip(draft.sermonUse ?? "", 900);
	if (!context || !sermonUse) return { error: "empty comparison" };
	const fit: ContextFit = draft.fit === "close" || draft.fit === "beyond" ? draft.fit : "applies";
	const questions = [...new Set((draft.questions ?? []).map((question) => clip(question ?? "", STUDY_LIMITS.question)).filter(Boolean))].slice(0, 4);
	return { key, context, sermonUse, fit, fitNote: clip(draft.fitNote ?? "", 400), questions, model, createdAt: now };
}

/** Every question a founder may mark for research: the study's and each comparison's. */
export function markableQuestions(data: Pick<SermonData, "study" | "comparisons">): string[] {
	return [...(data.study?.questions ?? []), ...data.comparisons.flatMap((comparison) => comparison.questions)];
}

/** Mark or unmark one of the sermon's own questions for later research. */
export function withResearchMark(data: SermonData, question: string, marked: boolean): SermonData | null {
	const text = question.trim();
	if (!markableQuestions(data).includes(text)) return null;
	const research = data.research.filter((entry) => entry !== text);
	return { ...data, research: marked ? [...research, text] : research };
}

/* -------------------------------------------------------------------------
 * What the Knowledge Vault indexes
 * ---------------------------------------------------------------------- */

/**
 * The item's body: the transcript with its clock, then the study and the
 * questions marked for research, so the Vault finds a sermon by anything said
 * in it or written about it. The sermon's words are labelled as the sermon's.
 */
export function sermonBody(data: SermonData, title: string, passageLabel: (key: string) => string): string {
	const lines: string[] = [`Sermon: ${title}${data.preacher ? `, preached by ${data.preacher}` : ""}`];
	if (data.passages.length) lines.push(`Passages: ${data.passages.map((passage) => passageLabel(passage.key)).join("; ")}`);
	if (data.study) {
		lines.push("", `Study notes (SureWord's study of the sermon). Big idea: ${data.study.bigIdea}`, data.study.summary);
		for (const section of data.study.sections) lines.push(`${section.heading}${section.passage ? ` (${section.passage})` : ""}: ${section.explanation}`);
		if (data.study.application) lines.push(`Application: ${data.study.application}`);
		if (data.study.questions.length) lines.push("Discussion questions:", ...data.study.questions.map((question) => `- ${question}`));
	}
	if (data.research.length) lines.push("", "Marked for later research:", ...data.research.map((question) => `- ${question}`));
	lines.push("", "Transcript (the sermon's words):", ...data.segments.map((segment) => `[${formatClock(segment.start)}] ${segment.text}`));
	return lines.join("\n").slice(0, 200_000);
}

/** A sermon item's data, read defensively: anything malformed falls back to empty. */
export function readSermonData(value: unknown): SermonData | null {
	if (typeof value !== "object" || value === null) return null;
	const data = value as Partial<SermonData>;
	if (data.status !== "transcribing" && data.status !== "ready") return null;
	return {
		status: data.status,
		preacher: typeof data.preacher === "string" ? data.preacher : null,
		permissionAt: typeof data.permissionAt === "string" ? data.permissionAt : "",
		source: data.source === "recording" ? "recording" : "upload",
		fileName: typeof data.fileName === "string" ? data.fileName : null,
		durationSec: typeof data.durationSec === "number" ? data.durationSec : 0,
		parts: Array.isArray(data.parts) ? data.parts.filter((part): part is number => typeof part === "number") : [],
		segments: Array.isArray(data.segments) ? data.segments : [],
		passages: Array.isArray(data.passages) ? data.passages : [],
		study: data.study && typeof data.study === "object" ? data.study : null,
		comparisons: Array.isArray(data.comparisons) ? data.comparisons : [],
		research: Array.isArray(data.research) ? data.research.filter((entry): entry is string => typeof entry === "string") : [],
	};
}

/** Title and preacher as typed, trimmed to their limits; the title falls back to the file's name. */
export function cleanSermonTitle(title: unknown, fallback: string): string {
	const text = typeof title === "string" ? title.replace(/\s+/g, " ").trim() : "";
	return (text || fallback).slice(0, SERMON_TITLE_MAX);
}

export function cleanPreacher(preacher: unknown): string | null {
	const text = typeof preacher === "string" ? preacher.replace(/\s+/g, " ").trim() : "";
	return text ? text.slice(0, SERMON_PREACHER_MAX) : null;
}
