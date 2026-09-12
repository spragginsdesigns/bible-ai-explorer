import { generateText, Output } from "ai";
import { z } from "zod";
import { resolveModel } from "@/lib/ai/provider";
import { prisma } from "@/lib/prisma";
import { htmlToPlainText } from "@/lib/markdown";
import { NOTE_HOUSE_STYLE } from "@/utils/noteHouseStyle";
import { systemPrompt } from "@/utils/systemPrompt";

/**
 * "Add to notes" used to store the assistant's answer verbatim, so a note
 * opened with the chat's second-person framing ("Austin, the Bible has a great
 * deal to say about this..."), carried the truncated question as its title and
 * ended wherever the answer ended. A note is the user's own study journal, so
 * the saved answer is rewritten here, in their voice, from the whole
 * conversation it came out of - one model call, and never at the cost of the
 * content: every failure path stores the original markdown untouched.
 */

/** How much of an answer is compared when locating the conversation it came from. */
export const MATCH_PREFIX_LENGTH = 400;

/**
 * Below this many normalized characters a prefix match proves nothing - two
 * different answers can open with the same sentence - so a very short save
 * composes from its own text rather than risk borrowing another chat.
 */
const MIN_MATCH_LENGTH = 80;

/** How many of the user's recent assistant messages a content match scans. */
const RECENT_ASSISTANT_MESSAGE_LIMIT = 50;

const MAX_TRANSCRIPT_MESSAGES = 24;
const MAX_TRANSCRIPT_CHARS = 24000;
/** Per-message cap, so one enormous turn cannot crowd out the rest of the chat. */
const MAX_MESSAGE_CHARS = 6000;
/** How much of an existing note is shown to the model so it does not repeat it. */
const MAX_EXISTING_NOTE_CHARS = 8000;

/**
 * Total budget for composition, shared by the first attempt and the retry. The
 * user is watching a spinner in the "Add to notes" sheet, so this is a wait,
 * not a background job; past it the answer is stored verbatim.
 */
const COMPOSE_TIMEOUT_MS = 45_000;

export interface TranscriptMessage {
	role: string;
	content: string;
}

export interface ComposeResult {
	/** The markdown to store: the composed note, or the original answer on any failure. */
	markdown: string;
	/** Title for a new note. Undefined when composition failed or the note already exists. */
	title?: string;
	/** False when the answer is being stored exactly as it arrived. */
	composed: boolean;
	/** Why composition did not happen. Absent when it did. */
	reason?: ComposeFailureReason;
}

export type ComposeFailureReason =
	/** The model call threw, or ran past COMPOSE_TIMEOUT_MS. */
	| "error"
	/** The model returned nothing parseable. */
	| "empty"
	/** Both attempts broke a rule that makes the result not a note (see validateComposedNote). */
	| "rejected";

/**
 * Lowercased letters and digits only, capped at the comparison window. Two
 * copies of one answer differ in whitespace and in the follow-up markers the
 * clients strip, so the comparison ignores everything but the words.
 */
export function normalizeForMatch(markdown: string): string {
	return markdown
		.normalize("NFKD")
		.replace(/\p{M}/gu, "")
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, " ")
		.trim()
		.slice(0, MATCH_PREFIX_LENGTH);
}

/** True when two answers are the same text, allowing for a trimmed tail. */
export function answersMatch(a: string, b: string): boolean {
	const left = normalizeForMatch(a);
	const right = normalizeForMatch(b);
	if (!left || !right) return false;
	if (Math.min(left.length, right.length) < MIN_MATCH_LENGTH) return left === right;
	return left.startsWith(right) || right.startsWith(left);
}

/**
 * The conversation an answer was saved from, found by content because the web
 * and mobile "Add to notes" sheets do not send a conversation id today. Every
 * query is scoped to this user: an answer must never be matched against, or
 * composed from, somebody else's chat.
 */
export async function findConversationForAnswer(
	userId: string,
	markdown: string
): Promise<string | null> {
	const candidates = await prisma.message.findMany({
		where: { role: "assistant", conversation: { userId } },
		orderBy: { createdAt: "desc" },
		take: RECENT_ASSISTANT_MESSAGE_LIMIT,
		select: { conversationId: true, content: true },
	});
	for (const candidate of candidates) {
		if (answersMatch(markdown, candidate.content)) return candidate.conversationId;
	}
	return null;
}

/** The conversation's messages in order, scoped to the user who owns it. */
export async function loadConversationTranscript(
	userId: string,
	conversationId: string
): Promise<TranscriptMessage[]> {
	const messages = await prisma.message.findMany({
		where: { conversationId, conversation: { userId } },
		orderBy: { createdAt: "asc" },
		select: { role: true, content: true },
	});
	return messages.map((message) => ({ role: message.role, content: message.content }));
}

/**
 * The chat as the composer sees it: the most recent turns, newest kept, oldest
 * dropped until the block fits. The answer being saved is passed to the model
 * separately, so trimming here can never lose it.
 */
export function buildTranscriptBlock(
	messages: readonly TranscriptMessage[],
	options: { maxMessages?: number; maxChars?: number } = {}
): string {
	const maxMessages = options.maxMessages ?? MAX_TRANSCRIPT_MESSAGES;
	const maxChars = options.maxChars ?? MAX_TRANSCRIPT_CHARS;

	const rendered: string[] = [];
	for (const message of messages.slice(-maxMessages)) {
		const content = message.content.trim();
		if (!content) continue;
		const speaker = message.role === "user" ? "User" : "SureWord";
		const body =
			content.length > MAX_MESSAGE_CHARS
				? `${content.slice(0, MAX_MESSAGE_CHARS)}\n[... this turn continues ...]`
				: content;
		rendered.push(`${speaker}: ${body}`);
	}

	// Drop from the front: the turns nearest the saved answer are the ones that
	// explain it. Always keep at least one.
	let total = rendered.reduce((sum, entry) => sum + entry.length + 2, 0);
	while (rendered.length > 1 && total > maxChars) {
		total -= rendered[0].length + 2;
		rendered.shift();
	}
	return rendered.join("\n\n");
}

const composedNoteSchema = z.object({
	title: z
		.string()
		.describe(
			"A descriptive noun phrase naming the subject of the note. Never a bare Scripture reference, never the user's question, never a truncated sentence."
		),
	markdown: z.string().describe("The note itself, as markdown, written in the user's own voice."),
});

/**
 * The composer's brief. The persona comes first so the doctrine of the note is
 * the doctrine of the app, then the house style every SureWord note follows,
 * then the rules that are specific to rewriting a chat answer into a journal
 * entry - which is the part the verbatim save got wrong.
 */
export function composerInstructions(options: { existingNoteTitle?: string } = {}): string {
	const shared = `${systemPrompt}

You are writing one entry in the user's own Bible study journal. They have just saved an answer out of their chat with you, and your task is to write the note they would have written themselves after reading it.

${NOTE_HOUSE_STYLE}

The rules for this task, in order of importance:

1. THE NOTE IS THE USER'S OWN WRITING. Every sentence is first person ("I", "my family", "what I need to do"). Never address the user as "you", never use their name, and never describe them in the third person.
2. NEVER MENTION THE CHAT. No "you asked", no "as we discussed", no "SureWord explained", no reference to the app, the question, or this rewrite. The note reads as if the user sat down and wrote what they had learned.
3. KEEP THE DOCTRINE AND THE SCRIPTURE OF THE ANSWER. Use the passages the conversation actually used. Do not add verses it did not cite, and do not soften, hedge or reinterpret anything it established.
4. Quote each primary verse in full as a blockquote whose last line is "> \u2014 Book Chapter:Verse, TRANSLATION", naming the translation the conversation itself used (KJV unless it clearly used another).
5. Use 3 to 7 "## " headings, each stating a claim rather than a label ("## The church is a body, not a building", not "## Background").
6. Finish with a closing section, in the user's voice, naming what they will actually do next: a commitment, an application, or a short written prayer.
7. Write only the note. No preamble, no closing remark about the note, no meta commentary of any kind.`;

	if (options.existingNoteTitle) {
		return `${shared}

This material is being added to a note the user already keeps, titled "${options.existingNoteTitle}". Its current content is given to you below.

- Write ONLY the new material, so it reads as the next part of that note. Do not restate what the note already says, and do not repeat verses it already quotes unless you are saying something genuinely new about them.
- Open with a "## " heading, never with a title line: the note already has a title.
- The title field is ignored for this save; repeat the note's existing title there.`;
	}

	return `${shared}

This is a new note. The title field names it: a descriptive noun phrase, in the user's voice, that says what the note is actually about.`;
}

/** Everything the composer is given about this particular save. */
export function buildComposerPrompt(input: {
	answer: string;
	transcript: string;
	existingNoteTitle?: string;
	existingNoteContent?: string;
	correction?: string;
}): string {
	const sections = [`THE ANSWER THE USER IS SAVING:\n${input.answer.trim()}`];
	sections.push(
		input.transcript
			? `THE CONVERSATION IT CAME OUT OF (oldest turn first):\n${input.transcript}`
			: "THE CONVERSATION IT CAME OUT OF: (not available - compose from the answer alone)"
	);
	if (input.existingNoteTitle) {
		sections.push(
			`THE NOTE IT IS BEING ADDED TO \u2014 "${input.existingNoteTitle}" (current content${
				input.existingNoteContent ? "" : ", currently empty"
			}):\n${input.existingNoteContent ?? ""}`.trim()
		);
	}
	if (input.correction) sections.push(`CORRECTION:\n${input.correction}`);
	return sections.join("\n\n");
}

export interface ComposedNote {
	title: string;
	markdown: string;
}

export type ValidationResult = { ok: true } | { ok: false; reason: string };

const SECOND_PERSON = /\b(you|your|yours|youre|yourself|yourselves)\b/i;

/**
 * Quoted Scripture is not the note's own voice, so it is removed before the
 * second-person check: the KJV says "you" (and the user's own verse quotes are
 * the one place it belongs), while "you" in the note's prose means the answer
 * was copied across instead of rewritten.
 */
function noteProseOnly(markdown: string): string {
	return markdown
		.split(/\r?\n/)
		.filter((line) => !/^\s*>/.test(line))
		.join("\n")
		.replace(/[\u201C\u201D][^\u201C\u201D]*[\u201C\u201D]/g, " ")
		.replace(/"[^"]*"/g, " ");
}

/** A first name long enough that matching it is not a coincidence. */
function nameNeedles(name: string | null | undefined): string[] {
	const trimmed = (name ?? "").trim();
	if (!trimmed) return [];
	const parts = trimmed.split(/\s+/).filter((part) => part.length >= 3 && /^\p{L}+$/u.test(part));
	const needles = parts.map((part) => part.toLowerCase());
	if (parts.length > 1) needles.push(trimmed.toLowerCase());
	return needles;
}

/**
 * The checks that decide whether what came back is a note at all. They are
 * deliberately few: a rejection costs a second model call and then the verbatim
 * save, so only the failures that reproduce the bug are fatal - the answer
 * copied across with its "you" framing intact, the user addressed by name, a
 * body with no structure, or nothing at all.
 */
export function validateComposedNote(
	note: ComposedNote,
	options: { userName?: string | null } = {}
): ValidationResult {
	const markdown = note.markdown.trim();
	const title = note.title.trim();
	if (!markdown) return { ok: false, reason: "the note body was empty" };

	const prose = noteProseOnly(markdown);
	if (SECOND_PERSON.test(prose)) {
		return { ok: false, reason: "the note addresses the user as \"you\" instead of being written in their own voice" };
	}
	if (SECOND_PERSON.test(title)) {
		return { ok: false, reason: "the title addresses the user as \"you\"" };
	}

	const haystack = `${title}\n${markdown}`.toLowerCase();
	for (const needle of nameNeedles(options.userName)) {
		if (new RegExp(`\\b${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(haystack)) {
			return { ok: false, reason: "the note names the user, which their own journal never does" };
		}
	}

	if (!/^##\s+\S/m.test(markdown)) {
		return { ok: false, reason: "the note has no \"## \" headings" };
	}
	return { ok: true };
}

/** The corrective line sent with the retry, naming exactly what was wrong. */
export function correctionFor(reason: string): string {
	return `Your previous attempt was rejected: ${reason}. Write it again as the user's own journal entry - first person throughout, never addressing or naming them, with 3 to 7 "## " claim headings and no mention of the chat.`;
}

/**
 * Rewrite a saved chat answer into a note in the user's voice. Never throws:
 * a model failure, a timeout, or two rejected attempts all return the original
 * markdown with `composed: false`, because losing the user's content is a far
 * worse outcome than saving it in the wrong voice.
 */
export async function composeNoteFromAnswer(options: {
	userId: string;
	/** The assistant answer the user tapped "Add to notes" on. */
	markdown: string;
	/** Set when the save targets an existing note; its title is kept. */
	noteId?: string;
	/** Sent by clients that know which conversation the answer came from. */
	conversationId?: string;
}): Promise<ComposeResult> {
	const verbatim = (reason: ComposeFailureReason): ComposeResult => ({
		markdown: options.markdown,
		composed: false,
		reason,
	});

	try {
		const conversationId =
			options.conversationId?.trim() ||
			(await findConversationForAnswer(options.userId, options.markdown));

		const [transcriptMessages, existingNote, user] = await Promise.all([
			conversationId
				? loadConversationTranscript(options.userId, conversationId)
				: Promise.resolve<TranscriptMessage[]>([]),
			options.noteId
				? prisma.note.findFirst({
						where: { id: options.noteId, userId: options.userId },
						select: { title: true, htmlContent: true, plainText: true },
					})
				: Promise.resolve(null),
			prisma.user.findUnique({ where: { id: options.userId }, select: { name: true } }),
		]);

		const existingNoteTitle = existingNote?.title;
		const existingNoteContent = existingNote
			? htmlToPlainText(existingNote.htmlContent || existingNote.plainText).slice(
					0,
					MAX_EXISTING_NOTE_CHARS
				)
			: undefined;

		const instructions = composerInstructions({ existingNoteTitle });
		const basePrompt = {
			answer: options.markdown,
			transcript: buildTranscriptBlock(transcriptMessages),
			existingNoteTitle,
			existingNoteContent,
		};

		const { model, providerOptions } = await resolveModel({
			userId: options.userId,
			fallbackEffort: "medium",
			structured: true,
		});
		// One budget for both attempts, so a retry cannot double the wait.
		const abortSignal = AbortSignal.timeout(COMPOSE_TIMEOUT_MS);

		let lastReason = "";
		for (let attempt = 0; attempt < 2; attempt += 1) {
			const { output } = await generateText({
				model,
				providerOptions,
				output: Output.object({ schema: composedNoteSchema }),
				instructions,
				prompt: buildComposerPrompt(
					attempt === 0 ? basePrompt : { ...basePrompt, correction: correctionFor(lastReason) }
				),
				abortSignal,
			});
			if (!output) return verbatim("empty");

			const candidate: ComposedNote = {
				title: output.title.trim(),
				markdown: output.markdown.trim(),
			};
			const validation = validateComposedNote(candidate, { userName: user?.name });
			if (validation.ok) {
				return {
					markdown: candidate.markdown,
					// An existing note keeps its own title; only a new note is named here.
					...(existingNoteTitle ? {} : { title: candidate.title || undefined }),
					composed: true,
				};
			}
			lastReason = validation.reason;
		}

		// Shape only, no user id and no content, matching the AI metrics.
		console.warn(
			`[note-composer] Both attempts rejected (${lastReason}); saving the answer verbatim.`
		);
		return verbatim("rejected");
	} catch (error) {
		console.error("[note-composer] Composition failed; saving the answer verbatim:", error);
		return verbatim("error");
	}
}
