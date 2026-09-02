import { prisma } from "@/lib/prisma";
import type { TranslationId } from "@/lib/bible/translations";
import { VERSE_INSIGHT_PROMPT_VERSION, verseTextHash } from "@/lib/verse-insight-key";

export interface VerseInsightKey {
	translation: TranslationId;
	reference: string;
	/** The verse text the client sent; hashed into the key, never stored. */
	text: string;
}

function whereKey(key: VerseInsightKey) {
	return {
		translation: key.translation,
		reference: key.reference,
		textHash: verseTextHash(key.text),
		promptVersion: VERSE_INSIGHT_PROMPT_VERSION,
	};
}

/**
 * The cached explanation for this verse, or null. A database failure is
 * logged and treated as a miss: the cache saves money, it must never cost
 * an answer.
 */
export async function readVerseInsight(key: VerseInsightKey): Promise<string | null> {
	try {
		const row = await prisma.verseInsight.findUnique({
			where: { translation_reference_textHash_promptVersion: whereKey(key) },
			select: { text: true },
		});
		return row?.text ?? null;
	} catch (error) {
		console.error("verse-insight cache read failed:", error);
		return null;
	}
}

/**
 * Store a complete explanation. Two readers tapping the same verse at once
 * both generate and both try to write; the first one wins and the second
 * is a no-op rather than an error.
 */
export async function writeVerseInsight(
	key: VerseInsightKey,
	text: string,
	model: string | null
): Promise<void> {
	try {
		await prisma.verseInsight.createMany({
			data: { ...whereKey(key), text, model },
			skipDuplicates: true,
		});
	} catch (error) {
		console.error("verse-insight cache write failed:", error);
	}
}
