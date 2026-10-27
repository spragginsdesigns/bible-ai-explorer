import "server-only";

import { bookByOrder } from "@/lib/bible/books";
import { getKjvChapter } from "@/lib/bible/kjv";
import { arrangeOptions } from "@/lib/quiz-rules";
import { KIDS_ADVENTURES } from "@/lib/beta/kids/adventures";
import { passageReference, passageVerses, verseKey, type AgeBand, type KidsAdventureView } from "@/lib/beta/kids/kids-rules";

/**
 * Every adventure for one age band, with its passage read from the bundled
 * KJV (never typed into the data by hand) and its quiz choices placed by Quiz
 * me's own seeded order, so a question shows the same way every time.
 */
export async function kidsAdventureViews(band: AgeBand): Promise<KidsAdventureView[]> {
	return Promise.all(
		KIDS_ADVENTURES.map(async (adventure) => {
			const bookName = bookByOrder(adventure.book)?.name ?? "";
			const chapters = new Map<number, string[]>();
			for (const segment of adventure.segments) {
				if (!chapters.has(segment.chapter)) chapters.set(segment.chapter, await getKjvChapter(adventure.book, segment.chapter));
			}
			return {
				id: adventure.id,
				title: adventure.title,
				book: adventure.book,
				reference: passageReference(bookName, adventure.segments),
				segments: adventure.segments,
				verses: passageVerses(adventure.segments).map(({ chapter, verse }) => ({
					key: verseKey(chapter, verse),
					chapter,
					verse,
					text: chapters.get(chapter)?.[verse - 1] ?? "",
				})),
				multiChapter: chapters.size > 1,
				retelling: adventure.retelling[band],
				questions: adventure.questions[band].map((question, index) => {
					const { options, answerIndex } = arrangeOptions(question.correct, question.wrong, `${adventure.id}:${band}:${index}`);
					return { prompt: question.prompt, options, answerIndex, verses: question.verses };
				}),
				memory: {
					text: adventure.memory.text,
					reference: `${bookName} ${adventure.memory.chapter}:${adventure.memory.verse}`,
				},
			};
		}),
	);
}
