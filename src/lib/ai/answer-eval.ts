/**
 * Mechanical scoring for SureWord answer evaluations.
 *
 * This module deliberately does not decide whether an explanation is good
 * theology. It checks the parts that can be proven from the request, the
 * assistant text, and successful Scripture-tool outputs: route health, tool
 * use, citation support, translation labels, exact quotations, and memory
 * side effects. A human review rubric belongs beside these scores, not inside
 * them.
 */

export type AnswerTranslation = "KJV" | "NKJV";

export interface AnswerToolCall {
	name: string;
	input?: unknown;
	output?: unknown;
	state?: string;
	error?: string;
}

export interface AnswerObservation {
	status: number;
	text: string;
	translation: AnswerTranslation;
	toolCalls: AnswerToolCall[];
	routeError?: string;
	durationMs?: number;
	steps?: number;
	usage?: {
		inputTokens?: number;
		outputTokens?: number;
		totalTokens?: number;
	};
}

export interface ExpectedQuote {
	reference: string;
	text: string;
	translation?: AnswerTranslation;
}

export interface AnswerEvalExpectation {
	/** One or more acceptable retrieval paths, each expressed as tool names. */
	retrievalToolAlternatives?: string[][];
	/** Tools that must appear and succeed, regardless of retrieval choice. */
	requiredTools?: string[];
	/** Writes are opt-in per fixture; this list is always forbidden. */
	forbiddenTools?: string[];
	requiredReferences?: string[];
	forbiddenReferences?: string[];
	requiredQuotes?: ExpectedQuote[];
	/** Every cited Bible reference must be present in successful tool evidence. */
	allCitationsBackedByTools?: boolean;
	translation?: AnswerTranslation;
	expectedErrorStatus?: number;
	expectedErrorContains?: string;
	memory?: {
		mode: "off" | "recall" | "write";
		requiredTools?: string[];
		requiredText?: string[];
	};
	/** A human reviewer rubric id, reported but never mechanically passed. */
	doctrineRubric?: string;
}

export interface AnswerEvalFixture {
	id: string;
	category: string;
	prompt: string;
	/** Optional raw request messages for malformed-input cases. */
	requestMessages?: { role: "user" | "assistant"; content: string }[];
	translation?: AnswerTranslation;
	history?: { role: "user" | "assistant"; content: string }[];
	expectation: AnswerEvalExpectation;
	/** Live runner skips side-effecting fixtures unless explicitly enabled. */
	sideEffects?: "read" | "write";
}

export interface AnswerEvalChecks {
	status: boolean;
	answerPresent: boolean;
	translation: boolean;
	toolUse: boolean;
	toolSuccess: boolean;
	references: boolean;
	quotes: boolean;
	memory: boolean;
	noForbiddenTools: boolean;
	noFabricatedReferences: boolean;
}

export interface AnswerEvalScore {
	fixtureId: string;
	category: string;
	pass: boolean;
	checks: AnswerEvalChecks;
	failures: string[];
	metrics: {
		durationMs?: number;
		inputTokens?: number;
		outputTokens?: number;
		totalTokens?: number;
		steps?: number;
		toolCalls: number;
		successfulToolCalls: number;
	};
	doctrineRubric?: string;
}

/** Writes are forbidden for ordinary read-only answer fixtures. */
export const DEFAULT_WRITE_TOOLS = [
	"saveMemory",
	"updateMemory",
	"deleteMemories",
	"addToNote",
	"updateNote",
	"setDailyCross",
	"startReadingPlan",
	"markReadingPlanDay",
];

/** Human-review dimensions; never collapsed into the mechanical pass bit. */
export const DOCTRINE_REVIEW_DIMENSIONS = [
	"scripture-grounding",
	"quote-and-reference-fidelity",
	"interpretive-coherence",
	"no-doctrinal-contradiction",
	"honest-uncertainty",
	"useful-application",
] as const;

const MEMORY_TOOLS = ["listMemories", "saveMemory", "updateMemory", "deleteMemories"];

function asRecord(value: unknown): Record<string, unknown> | null {
	return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

/** Normalize only representation noise; substantive words remain intact. */
export function normalizeAnswerText(value: string): string {
	return value
		.normalize("NFKC")
		.replace(/[“”„‟]/g, '"')
		.replace(/[‘’‚‛]/g, "'")
		.replace(/[\u2010-\u2015]/g, "-")
		.replace(/\s+/g, " ")
		.trim()
		.toLowerCase();
}

function refKey(reference: string): string {
	const parsed = parseReference(reference);
	return parsed
		? `${parsed.book}:${parsed.chapter}:${parsed.verse}-${parsed.endChapter}:${parsed.endVerse}`
		: normalizeAnswerText(reference).replace(/\s*,\s*(?:kjv|nkjv)\b/g, "").replace(/\s+/g, " ").trim();
}

interface ParsedReference {
	book: string;
	chapter: number;
	verse: number;
	endChapter: number;
	endVerse: number;
}

function canonicalBook(book: string): string {
	const normalized = normalizeAnswerText(book).replace(/\s+/g, " ").trim();
	if (normalized === "psalm") return "psalms";
	if (normalized === "song of songs") return "song of solomon";
	if (normalized === "revelations") return "revelation";
	return normalized;
}

function parseReference(reference: string): ParsedReference | null {
	const withoutTranslation = normalizeAnswerText(reference).replace(/\s*,\s*(?:kjv|nkjv)\b/g, "").trim();
	const match = withoutTranslation.match(/^(.+?)\s+(\d{1,3}):(\d{1,3})(?:\s*[-–—]\s*(?:(\d{1,3}):)?(\d{1,3}))?$/);
	if (!match) return null;
	return {
		book: canonicalBook(match[1]),
		chapter: Number(match[2]),
		verse: Number(match[3]),
		endChapter: Number(match[4] ?? match[2]),
		endVerse: Number(match[5] ?? match[3]),
	};
}

function referenceCovers(container: string, target: string): boolean {
	const outer = parseReference(container);
	const inner = parseReference(target);
	if (!outer || !inner || outer.book !== inner.book) return false;
	const outerStart = outer.chapter * 1000 + outer.verse;
	const outerEnd = outer.endChapter * 1000 + outer.endVerse;
	const innerStart = inner.chapter * 1000 + inner.verse;
	const innerEnd = inner.endChapter * 1000 + inner.endVerse;
	return outerStart <= innerStart && outerEnd >= innerEnd;
}

const BIBLE_BOOKS = [
	"Genesis", "Exodus", "Leviticus", "Numbers", "Deuteronomy", "Joshua", "Judges", "Ruth",
	"1 Samuel", "2 Samuel", "1 Kings", "2 Kings", "1 Chronicles", "2 Chronicles", "Ezra",
	"Nehemiah", "Esther", "Job", "Psalms", "Psalm", "Proverbs", "Ecclesiastes", "Song of Solomon",
	"Song of Songs", "Isaiah", "Jeremiah", "Lamentations", "Ezekiel", "Daniel", "Hosea", "Joel",
	"Amos", "Obadiah", "Jonah", "Micah", "Nahum", "Habakkuk", "Zephaniah", "Haggai", "Zechariah",
	"Malachi", "Matthew", "Mark", "Luke", "John", "Acts", "Romans", "1 Corinthians", "2 Corinthians",
	"Galatians", "Ephesians", "Philippians", "Colossians", "1 Thessalonians", "2 Thessalonians", "1 Timothy",
	"2 Timothy", "Titus", "Philemon", "Hebrews", "James", "1 Peter", "2 Peter", "1 John", "2 John",
	"3 John", "Jude", "Revelation",
];

const BOOK_PATTERN = BIBLE_BOOKS.sort((a, b) => b.length - a.length).map((book) => book.replace(/ /g, "\\s+")).join("|");
const REFERENCE_PATTERN = new RegExp(
	`\\b(?:${BOOK_PATTERN})\\s+\\d{1,3}:\\d{1,3}(?:\\s*[-–—]\\s*(?:\\d{1,3}:)?\\d{1,3})?(?:\\s*,?\\s*(?:KJV|NKJV))?\\b`,
	"gi",
);

export function extractBibleReferences(text: string): string[] {
	return [...text.matchAll(REFERENCE_PATTERN)].map((match) => match[0].trim());
}

function isSuccessfulToolCall(call: AnswerToolCall): boolean {
	if (call.error || call.state === "output-error" || call.state === "error") return false;
	const output = asRecord(call.output);
	if (output && (output.success === false || output.ok === false)) return false;
	if (output && typeof output.error === "string" && output.error.trim()) return false;
	return call.output !== undefined && call.output !== null;
}

function collectObjects(value: unknown, out: Record<string, unknown>[]): void {
	if (Array.isArray(value)) {
		for (const item of value) collectObjects(item, out);
		return;
	}
	const record = asRecord(value);
	if (!record) return;
	out.push(record);
	for (const child of Object.values(record)) collectObjects(child, out);
}

interface RetrievedEvidence {
	reference: string;
	text: string;
}

/** Pull verse evidence from the structured output, never from answer prose. */
export function extractRetrievedEvidence(calls: AnswerToolCall[]): RetrievedEvidence[] {
	const evidence: RetrievedEvidence[] = [];
	const scriptureTools = new Set(["searchScripture", "findVerses", "getPassage", "getCrossReferences"]);
	for (const call of calls) {
		if (!scriptureTools.has(call.name)) continue;
		if (!isSuccessfulToolCall(call)) continue;
		const objects: Record<string, unknown>[] = [];
		collectObjects(call.output, objects);
		for (const object of objects) {
			if (typeof object.reference !== "string" || typeof object.text !== "string") continue;
			if (!/\b\d{1,3}:\d{1,3}\b/.test(object.reference)) continue;
			evidence.push({ reference: object.reference, text: object.text });
		}
	}
	return evidence;
}

function hasReference(text: string, expected: string): boolean {
	return extractBibleReferences(text).some((reference) => referenceCovers(reference, expected) || refKey(reference) === refKey(expected));
}

function hasToolNamed(calls: AnswerToolCall[], name: string): boolean {
	return calls.some((call) => call.name === name);
}

function hasSuccessfulToolNamed(calls: AnswerToolCall[], name: string): boolean {
	return calls.some((call) => call.name === name && isSuccessfulToolCall(call));
}

function citeKeySet(calls: AnswerToolCall[]): Set<string> {
	return new Set(extractRetrievedEvidence(calls).map((item) => refKey(item.reference)));
}

function sourceReferences(calls: AnswerToolCall[]): string[] {
	return extractRetrievedEvidence(calls).map((item) => item.reference);
}

function sourceTranslation(calls: AnswerToolCall[]): AnswerTranslation | null {
	const values: unknown[] = [];
	const visit = (value: unknown): void => {
		if (Array.isArray(value)) return value.forEach(visit);
		const record = asRecord(value);
		if (record) return Object.entries(record).forEach(([key, child]) => {
			if (key === "translation" && (child === "KJV" || child === "NKJV")) values.push(child);
			visit(child);
		});
		if (typeof value === "string") values.push(value);
	};
	for (const call of calls) visit(call.output);
	for (const value of values) {
		if (value === "KJV" || value === "NKJV") return value;
		if (typeof value !== "string") continue;
		const match = value.match(/\b(KJV|NKJV)\s*:/i);
		if (match) return match[1].toUpperCase() as AnswerTranslation;
	}
	return null;
}

function scoreStatus(
	fixture: AnswerEvalFixture,
	observation: AnswerObservation,
	failures: string[],
): boolean {
	const expected = fixture.expectation.expectedErrorStatus;
	if (expected !== undefined) {
		const pass = observation.status === expected && !observation.text.trim();
		if (!pass) failures.push(`expected HTTP ${expected} with no answer, got ${observation.status}`);
		if (pass && fixture.expectation.expectedErrorContains && !normalizeAnswerText(observation.routeError ?? "").includes(normalizeAnswerText(fixture.expectation.expectedErrorContains))) {
			failures.push("expected error message was not present");
			return false;
		}
		return pass;
	}
	const pass = observation.status >= 200 && observation.status < 300 && !observation.routeError;
	if (!pass) failures.push(`route did not complete successfully (HTTP ${observation.status})`);
	return pass;
}

function scoreTranslation(
	fixture: AnswerEvalFixture,
	observation: AnswerObservation,
	failures: string[],
): boolean {
	const expected = fixture.expectation.translation ?? fixture.translation;
	if (!expected) return true;
	const opposite = expected === "KJV" ? "NKJV" : "KJV";
	const answer = normalizeAnswerText(observation.text);
	const explicitOpposite = new RegExp(`\\b${opposite.toLowerCase()}\\b`).test(answer) && !new RegExp(`\\b${expected.toLowerCase()}\\b`).test(answer);
	const source = sourceTranslation(observation.toolCalls);
	if (observation.translation !== expected || explicitOpposite || (source !== null && source !== expected)) {
		failures.push(`translation mismatch: expected ${expected}`);
		return false;
	}
	return true;
}

function scoreTools(
	fixture: AnswerEvalFixture,
	observation: AnswerObservation,
	failures: string[],
): { used: boolean; successful: boolean } {
	const { toolCalls } = observation;
	const expected = fixture.expectation;
	const required = expected.requiredTools ?? [];
	const alternatives = expected.retrievalToolAlternatives ?? [];
	const requiredPass = required.every((name) => hasSuccessfulToolNamed(toolCalls, name));
	const alternativePass = alternatives.length === 0 || alternatives.some((set) => set.every((name) => hasSuccessfulToolNamed(toolCalls, name)));
	if (!requiredPass) failures.push(`required tool did not succeed: ${required.filter((name) => !hasSuccessfulToolNamed(toolCalls, name)).join(", ")}`);
	if (!alternativePass) failures.push("no allowed Scripture retrieval tool path completed successfully");
	const unsuccessful = toolCalls.filter((call) => !isSuccessfulToolCall(call));
	if (unsuccessful.length > 0) failures.push(`tool call did not succeed: ${[...new Set(unsuccessful.map((call) => call.name))].join(", ")}`);
	const forbidden = new Set([...(fixture.sideEffects === "write" ? [] : DEFAULT_WRITE_TOOLS), ...(expected.forbiddenTools ?? [])]);
	const forbiddenCalls = toolCalls.filter((call) => forbidden.has(call.name));
	if (forbiddenCalls.length > 0) failures.push(`forbidden write tool used: ${[...new Set(forbiddenCalls.map((call) => call.name))].join(", ")}`);
	return {
		used: requiredPass && alternativePass,
		successful: toolCalls.every(isSuccessfulToolCall),
	};
}

function scoreReferences(
	fixture: AnswerEvalFixture,
	observation: AnswerObservation,
	failures: string[],
): { required: boolean; fabricated: boolean } {
	const answer = observation.text;
	const expected = fixture.expectation;
	const missing = (expected.requiredReferences ?? []).filter((reference) => !hasReference(answer, reference));
	if (missing.length > 0) failures.push(`missing required reference(s): ${missing.join(", ")}`);
	const forbidden = (expected.forbiddenReferences ?? []).filter((reference) => hasReference(answer, reference));
	if (forbidden.length > 0) failures.push(`forbidden reference(s) cited: ${forbidden.join(", ")}`);
	let fabricated = true;
	if (expected.allCitationsBackedByTools) {
		const backed = sourceReferences(observation.toolCalls);
		const unsupported = extractBibleReferences(answer).filter((reference) => !backed.some((source) => referenceCovers(source, reference) || refKey(source) === refKey(reference)));
		if (unsupported.length > 0) {
			fabricated = false;
			failures.push(`citation(s) lack successful tool evidence: ${[...new Set(unsupported)].join(", ")}`);
		}
	}
	return { required: missing.length === 0 && forbidden.length === 0, fabricated };
}

function scoreQuotes(
	fixture: AnswerEvalFixture,
	observation: AnswerObservation,
	failures: string[],
): boolean {
	const expected = fixture.expectation.requiredQuotes ?? [];
	const answer = normalizeAnswerText(observation.text);
	const evidence = extractRetrievedEvidence(observation.toolCalls);
	let pass = true;
	for (const quote of expected) {
		const quoteText = normalizeAnswerText(quote.text);
		const answerHasWords = answer.includes(quoteText);
		const answerHasRef = hasReference(observation.text, quote.reference);
		const source = evidence.find((item) => refKey(item.reference) === refKey(quote.reference));
		const sourceHasExactText = source !== undefined && normalizeAnswerText(source.text) === quoteText;
		if (!answerHasWords || !answerHasRef) {
			failures.push(`answer did not contain the exact ${quote.reference} quotation and citation`);
			pass = false;
		}
		if (!sourceHasExactText) {
			failures.push(`tool evidence did not contain exact ${quote.reference} text`);
			pass = false;
		}
		if (quote.translation && answerHasWords && !new RegExp(`\\b${quote.translation}\\b`, "i").test(observation.text)) {
			failures.push(`quotation ${quote.reference} did not identify ${quote.translation}`);
			pass = false;
		}
	}
	// Any assistant blockquote carrying a Bible reference is a quote claim too,
	// even when the fixture did not enumerate that particular verse. Compare its
	// body with canonical tool evidence so a source being present cannot hide a
	// misquotation.
	const lines = observation.text.split(/\r?\n/);
	for (let index = 0; index < lines.length; index += 1) {
		if (!/^>\s?/.test(lines[index])) continue;
		const block: string[] = [];
		while (index < lines.length && /^>\s?/.test(lines[index])) block.push(lines[index++].replace(/^>\s?/, ""));
		index -= 1;
		const refs = extractBibleReferences(block.join(" "));
		if (refs.length === 0) continue;
		const citation = refs.at(-1)!;
		const source = evidence.find((item) => referenceCovers(item.reference, citation) || refKey(item.reference) === refKey(citation));
		const body = normalizeAnswerText(block.filter((line) => !extractBibleReferences(line).length).join(" "))
			.replace(/^["']|["']$/g, "");
		if (!source || body.length < 8 || !normalizeAnswerText(source.text).includes(body)) {
			failures.push(`blockquote ${citation} was not supported by exact tool text`);
			pass = false;
		}
	}
	return pass;
}

function scoreMemory(
	fixture: AnswerEvalFixture,
	observation: AnswerObservation,
	failures: string[],
): boolean {
	const memory = fixture.expectation.memory;
	if (!memory) return true;
	const calls = observation.toolCalls;
	const required = memory.requiredTools ?? (memory.mode === "recall" ? ["listMemories"] : memory.mode === "write" ? ["saveMemory"] : []);
	const requiredPass = required.every((name) => hasSuccessfulToolNamed(calls, name));
	if (!requiredPass) failures.push(`memory tool did not succeed: ${required.filter((name) => !hasSuccessfulToolNamed(calls, name)).join(", ")}`);
	const text = normalizeAnswerText(observation.text);
	const missingText = (memory.requiredText ?? []).filter((value) => !text.includes(normalizeAnswerText(value)));
	if (missingText.length > 0) failures.push(`memory answer omitted required context: ${missingText.join(", ")}`);
	const memoryCalls = calls.filter((call) => MEMORY_TOOLS.includes(call.name));
	if (memory.mode === "off" && memoryCalls.length > 0) failures.push("memory was disabled but a memory tool ran");
	return requiredPass && missingText.length === 0 && !(memory.mode === "off" && memoryCalls.length > 0);
}

export function scoreAnswer(
	fixture: AnswerEvalFixture,
	observation: AnswerObservation,
): AnswerEvalScore {
	const failures: string[] = [];
	const status = scoreStatus(fixture, observation, failures);
	const expectedError = fixture.expectation.expectedErrorStatus !== undefined;
	const answerPresent = expectedError ? !observation.text.trim() : observation.text.trim().length > 0;
	if (!answerPresent) failures.push(expectedError ? "an answer was emitted for an expected error" : "answer text was empty");
	const translation = expectedError ? true : scoreTranslation(fixture, observation, failures);
	const toolResult = expectedError ? { used: true, successful: true } : scoreTools(fixture, observation, failures);
	const referenceResult = expectedError ? { required: true, fabricated: true } : scoreReferences(fixture, observation, failures);
	const quotes = expectedError ? true : scoreQuotes(fixture, observation, failures);
	const memory = expectedError ? true : scoreMemory(fixture, observation, failures);
	const forbidden = !failures.some((failure) => failure.startsWith("forbidden write tool used:"));
	const checks: AnswerEvalChecks = {
		status,
		answerPresent,
		translation,
		toolUse: toolResult.used,
		toolSuccess: toolResult.successful,
		references: referenceResult.required,
		quotes,
		memory,
		noForbiddenTools: forbidden,
		noFabricatedReferences: referenceResult.fabricated,
	};
	return {
		fixtureId: fixture.id,
		category: fixture.category,
		pass: failures.length === 0,
		checks,
		failures,
		metrics: {
			durationMs: observation.durationMs,
			inputTokens: observation.usage?.inputTokens,
			outputTokens: observation.usage?.outputTokens,
			totalTokens: observation.usage?.totalTokens,
			...(observation.steps !== undefined ? { steps: observation.steps } : {}),
			toolCalls: observation.toolCalls.length,
			successfulToolCalls: observation.toolCalls.filter(isSuccessfulToolCall).length,
		},
		doctrineRubric: fixture.expectation.doctrineRubric,
	};
}

export function validateAnswerFixtures(fixtures: AnswerEvalFixture[]): string[] {
	const errors: string[] = [];
	const ids = new Set<string>();
	for (const fixture of fixtures) {
		if (!fixture.id || ids.has(fixture.id)) errors.push(`duplicate or empty fixture id: ${fixture.id}`);
		ids.add(fixture.id);
		if (!fixture.category) errors.push(`${fixture.id}: category is required`);
		if (!fixture.prompt.trim() && !fixture.requestMessages) errors.push(`${fixture.id}: prompt is required`);
		if (!fixture.expectation) errors.push(`${fixture.id}: expectation is required`);
	}
	return errors;
}
