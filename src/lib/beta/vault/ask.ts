import "server-only";

import { generateText, Output } from "ai";
import { z } from "zod";
import { resolveModel } from "@/lib/ai/provider";
import { stripDashes } from "@/lib/ai/plain-dashes";
import { doctrinalFoundation } from "@/utils/systemPrompt";
import { meaningSearch, refreshVaultIndex, type IndexStatus } from "@/lib/beta/vault/meaning";
import { labelsFor, parseVaultPassage, scanText } from "@/lib/beta/vault/passages";
import { fuse, hydrateMeaning, readSafely } from "@/lib/beta/vault/search";
import type { SourceQuery } from "@/lib/beta/vault/sources";
import {
	VAULT_KINDS,
	checkAnswerPoints,
	cleanUncovered,
	clip,
	filterRange,
	orTsQuery,
	parseTimeWindow,
	parseVaultKey,
	questionTerms,
	type AnswerPoint,
	type VaultEntry,
	type VaultFilters,
	type VaultKind,
} from "@/lib/beta/vault/vault-rules";

/**
 * "Ask your study history" (docs/beta/vault.md): a question answered only
 * from the owner's own vault. The server finds the sources first (words,
 * meaning, and any passage the question names, inside any period it names),
 * then the model writes points that must each cite those sources by number.
 * Points citing nothing real are dropped before anyone sees them. Nothing is
 * stored: the answer lives on the screen that asked for it.
 */

export const VAULT_QUESTION_MAX = 400;
const SOURCES_MAX = 14;
const PER_KIND = 10;
const SOURCE_CHARS = 900;

export interface AskResult {
	status: "answered" | "empty";
	question: string;
	/** The period searched, read back: "the last 6 months", or null for all of it. */
	period: string | null;
	points: AnswerPoint[];
	/** What the sources could not answer, in the model's words. */
	uncovered: string | null;
	/** The sources, numbered in this order (1-based) as the points cite them. */
	sources: VaultEntry[];
	index: IndexStatus | null;
}

const answerSchema = z.object({
	points: z
		.array(
			z.object({
				text: z.string().describe("One or two plain sentences to the person, about their own study."),
				sources: z.array(z.number().int()).describe("Numbers of the sources this point rests on; at least one."),
			}),
		)
		.max(8),
	uncovered: z.string().nullable().describe("What the sources do not show, or null."),
});

const ASK_GUIDANCE = `YOU ARE ANSWERING FROM THIS PERSON'S OWN STUDY HISTORY, THEIR SUREWORD KNOWLEDGE VAULT.

The numbered sources are the only record of what they have studied. Answer only from them: never add study they did not do, never guess a date, never invent a note, chat, highlight or verse, and never fill a gap from general knowledge.

Write to them in the second person ("You studied...", "In March you asked..."), warmly and plainly, as a recap of their own study. Return points: each is one or two sentences and lists the numbers of the sources it rests on, at least one, in its "sources" field only; never write source numbers in the text. Say when, from the dates given. Bring related study together, and where the sources show their thinking developing over time, say so without judging or scoring it.

Scripture: quote a verse only when its exact words appear in a source, with its reference. What SureWord answered in a chat is SureWord's teaching, not Scripture: say "SureWord explained" and never present it as the Bible's words. A note is their own words: say "you wrote".

If the sources only partly answer, give what they show and put what is missing in "uncovered"; when nothing is missing, "uncovered" is null. If they do not answer it at all, return no points and say so in "uncovered". No headings, no lists inside a point, no markdown.`;

function sourceBlock(entry: VaultEntry, n: number): string {
	const when = entry.startedAt && entry.startedAt.slice(0, 10) !== entry.date.slice(0, 10)
		? `${entry.startedAt.slice(0, 10)}, last changed ${entry.date.slice(0, 10)}`
		: entry.date.slice(0, 10);
	const kind = {
		note: "Note you wrote",
		highlight: "Verse you highlighted",
		chat: "Chat with SureWord",
		reading: "Reading",
		verse: "Verse you are learning by heart",
		memory: "Something SureWord remembers about you",
		sermon: "Sermon study from your church",
		study: "Beta study",
	}[entry.kind];
	const lines = [
		`[${n}] ${kind}: "${entry.title}" (${when})`,
		entry.detail ? `Detail: ${entry.detail}` : "",
		entry.passages.length ? `Passages: ${entry.passages.map((chip) => chip.label).join(", ")}` : "",
		entry.topics.length ? `Topics: ${entry.topics.join(", ")}` : "",
		entry.excerpt ? clip(entry.excerpt, SOURCE_CHARS) : "",
	];
	return lines.filter(Boolean).join("\n");
}

/** The sources a question is answered from, best first. */
export async function findAskSources(
	userId: string,
	question: string,
	filters: Pick<VaultFilters, "kinds" | "from" | "to" | "topic" | "passage">,
	now = new Date(),
): Promise<{ sources: VaultEntry[]; period: string | null; index: IndexStatus | null }> {
	const window = filters.from || filters.to ? null : parseTimeWindow(question, now);
	const range = window ? { since: window.since, until: window.until } : filterRange({ from: filters.from, to: filters.to, before: null });
	const period = window?.label ?? (filters.from || filters.to ? [filters.from, filters.to].filter(Boolean).join(" to ") : null);
	const kinds: readonly VaultKind[] = filters.kinds.length ? filters.kinds : VAULT_KINDS;
	const terms = questionTerms(question);
	const tsquery = orTsQuery(terms);
	const filterPassage = parseVaultPassage(filters.passage);
	// A passage named in the question ("my notes on Romans 8") is searched as one, too.
	const named = scanText(question).map((key) => parseVaultKey(key)).filter((key) => key && key.verse === undefined);
	const questionPassage = named.length ? parseVaultPassage(labelsFor([`${named[0]!.book}.${named[0]!.chapter}`])[0] ?? null) : null;

	const base: Omit<SourceQuery, "limit"> = {
		userId,
		range,
		passage: filterPassage,
		topic: filters.topic,
		words: tsquery ? { kind: "or", value: tsquery } : null,
		needles: [...terms, ...(questionPassage ? [questionPassage.label] : [])],
		excerptChars: SOURCE_CHARS,
	};
	const index = await refreshVaultIndex(userId).catch(() => null);
	// With no subject words ("What did I study last month?"), the answer is their most recent study in the period.
	const subjectless = !base.words && !questionPassage;
	const [wordLists, passageLists, meaning] = await Promise.all([
		base.words || subjectless
			? Promise.all(kinds.map((kind) => readSafely(kind, { ...base, limit: PER_KIND })))
			: Promise.resolve([] as VaultEntry[][]),
		questionPassage && !filterPassage
			? Promise.all(kinds.map((kind) => readSafely(kind, { ...base, words: null, passage: questionPassage, limit: PER_KIND })))
			: Promise.resolve([] as VaultEntry[][]),
		subjectless ? Promise.resolve([]) : meaningSearch(userId, question, kinds, PER_KIND),
	]);
	const meaningLists = await hydrateMeaning(base, meaning, { wholeChunk: true });
	return { sources: fuse([...wordLists, ...passageLists], meaningLists, SOURCES_MAX), period, index };
}

export async function askVault(
	userId: string,
	question: string,
	filters: Pick<VaultFilters, "kinds" | "from" | "to" | "topic" | "passage">,
	now = new Date(),
): Promise<AskResult> {
	const { sources, period, index } = await findAskSources(userId, question, filters, now);
	if (!sources.length) {
		// Nothing of theirs to answer from: no model call, no spend.
		return { status: "empty", question, period, points: [], uncovered: null, sources: [], index };
	}
	const { model, providerOptions } = await resolveModel({ userId, effort: "low", structured: true });
	const prompt = [
		`Today is ${now.toISOString().slice(0, 10)}. The period they asked about: ${period ?? "all of their history"}.`,
		`Their question: ${question}`,
		`Sources from their vault, numbered:`,
		sources.map((entry, i) => sourceBlock(entry, i + 1)).join("\n\n"),
	].join("\n\n");
	const { output } = await generateText({
		model,
		system: `${doctrinalFoundation}\n\n${ASK_GUIDANCE}`,
		prompt,
		output: Output.object({ schema: answerSchema }),
		providerOptions,
		maxOutputTokens: 3000,
	});
	const points = checkAnswerPoints(output.points, sources.length).map((point) => ({ ...point, text: stripDashes(point.text) }));
	const uncoveredText = cleanUncovered(output.uncovered);
	const uncovered = uncoveredText ? stripDashes(uncoveredText) : null;
	return { status: "answered", question, period, points, uncovered, sources, index };
}
