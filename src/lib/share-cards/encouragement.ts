import "server-only";

import { generateText } from "ai";
import { resolveGuestModel } from "@/lib/ai/provider";
import { stripDashes } from "@/lib/ai/plain-dashes";
import { prisma } from "@/lib/prisma";

/**
 * The line of encouragement a share card can carry under a verse
 * (docs/FEATURES.md, "Share cards").
 *
 * A verse card alone is what every Bible app makes. This line is what makes
 * one from SureWord worth sending: a sentence that turns the verse toward the
 * person reading it. It is written once per passage from the KJV text alone
 * and shared by every reader, like VerseInsight, so the popular verses cost
 * nothing after the first share.
 *
 * Only an authenticated request writes one (POST /api/cards/encouragement).
 * The public card route only reads, so a stranger hammering card URLs can
 * never spend a model call.
 */

/** Bump with the wording below; old lines stay in the table, unread. */
export const ENCOURAGEMENT_PROMPT_VERSION = 1;

/** Long enough for a real sentence, short enough to sit under a verse. */
export const MAX_ENCOURAGEMENT_LENGTH = 150;

const SYSTEM = [
	"You are SureWord, a Bible study companion written as a saved, born-again believer in Jesus Christ who believes every word of the King James Bible absolutely.",
	"Write ONE sentence of encouragement for someone who will see this verse on a card a friend sent them.",
	"Rules:",
	"- Draw it only from what the verse itself says. Never add a promise, doctrine or claim the verse does not make, and never soften or reinterpret it.",
	"- Do not restate or paraphrase the verse: the reader can see it right above your line. Say what it means for them today, the comfort, hope, conviction or call to trust that the verse itself gives.",
	"- Speak to the reader as \"you\". Point them to God and His Word, not to themselves.",
	"- The tone of these (for other verses; never reuse them): \"Whatever is pressing on you today, you are not facing it alone.\" / \"Hand Him the worry you have been carrying; He wants to hear every word of it.\"",
	`- At most ${MAX_ENCOURAGEMENT_LENGTH} characters. No quotation of the verse, no reference, no emoji, no hashtags, no dashes.`,
	"- Warm, plain and reverent. Never mention AI, cards, apps or SureWord.",
	"Reply with the sentence only.",
].join("\n");

/**
 * The cached line, or null. A database failure is a miss, never an error.
 *
 * `anyVersion` is for the readers (the public card and the verse page): a
 * card URL scraped into a chat must keep drawing after the prompt version is
 * bumped, so they take the newest line of any version. The writer asks for
 * the current version only, so a bump does regenerate.
 */
export async function readEncouragement(
	reference: string,
	options: { anyVersion?: boolean } = {}
): Promise<string | null> {
	try {
		const row = options.anyVersion
			? await prisma.verseEncouragement.findFirst({
					where: { reference },
					orderBy: { promptVersion: "desc" },
					select: { text: true },
				})
			: await prisma.verseEncouragement.findUnique({
					where: { reference_promptVersion: { reference, promptVersion: ENCOURAGEMENT_PROMPT_VERSION } },
					select: { text: true },
				});
		return row?.text ?? null;
	} catch (error) {
		console.error("Encouragement read failed:", error);
		return null;
	}
}

/**
 * Model output to the line a card prints: one sentence, no wrapping quotes,
 * no dashes (agents and SureWord write none), bounded. Null when nothing
 * usable came back, so a bad generation is never cached.
 */
export function cleanEncouragement(raw: string): string | null {
	let text = stripDashes(raw)
		.replace(/[ \t\r\n]+/g, " ")
		.trim()
		.replace(/^["“‘']+|["”’']+$/g, "")
		.trim();
	if (!text) return null;
	if (text.length > MAX_ENCOURAGEMENT_LENGTH) {
		// Prefer a whole sentence; otherwise end at a clause, then at a word. A
		// single long sentence used to come back null on every share, spending a
		// fresh generation each time.
		const cut = text.slice(0, MAX_ENCOURAGEMENT_LENGTH);
		const sentence = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
		const clause = Math.max(cut.lastIndexOf(", "), cut.lastIndexOf("; "));
		const word = cut.lastIndexOf(" ");
		if (sentence >= 40) text = cut.slice(0, sentence + 1);
		else if (clause >= 60) text = cut.slice(0, clause);
		else if (word >= 60) text = cut.slice(0, word);
		else return null;
	}
	return /[.!?]$/.test(text) ? text : `${text.replace(/[,;:]+$/, "")}.`;
}

/**
 * The line for this passage, writing it if no reader has asked before. Two
 * readers sharing the same verse at once both generate, and the second write
 * loses the unique-key race harmlessly.
 */
export async function ensureEncouragement(reference: string, kjvText: string): Promise<string> {
	const cached = await readEncouragement(reference);
	if (cached) return cached;

	const resolved = resolveGuestModel();
	const { text } = await generateText({
		model: resolved.model,
		system: SYSTEM,
		prompt: `${reference} (KJV): ${kjvText}`,
		// Reasoning counts against the cap on the house model; 400 risked an
		// empty reply, which is never cached and fails the share.
		maxOutputTokens: 1500,
		providerOptions: resolved.providerOptions,
	});
	const line = cleanEncouragement(text);
	if (!line) throw new Error("The encouragement came back empty.");

	try {
		await prisma.verseEncouragement.create({
			data: {
				reference,
				promptVersion: ENCOURAGEMENT_PROMPT_VERSION,
				text: line,
				model: resolved.definition.id,
			},
		});
	} catch {
		// Another reader's request wrote it first; serve whichever line won.
		return (await readEncouragement(reference)) ?? line;
	}
	return line;
}
