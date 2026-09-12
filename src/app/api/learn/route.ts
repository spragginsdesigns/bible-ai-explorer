import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthUser } from "@/lib/auth";
import { addCard, learnVerseText } from "@/lib/learn";

const addSchema = z.object({
	book: z.number().int().min(1).max(66), // canonical order, 1-66
	chapter: z.number().int().min(1).max(200),
	verse: z.number().int().min(1).max(200),
	translation: z.enum(["KJV", "NKJV"]),
	source: z.enum(["sheet", "highlight", "chat"]),
});

/**
 * Add a verse to the caller's Learn queue. Idempotent on the verse: a verse
 * already in the queue comes back as it stands with a 200, so tapping "Learn
 * this verse" twice never resets the schedule or makes a second card.
 */
export async function POST(req: Request) {
	try {
		const userId = await getAuthUser();

		const parsed = addSchema.safeParse(await req.json().catch(() => null));
		if (!parsed.success) {
			return NextResponse.json(
				{
					error:
						"Invalid input: 'book' (1-66), 'chapter', 'verse', a 'translation' of KJV or NKJV and a 'source' of sheet, highlight or chat are required.",
				},
				{ status: 400 }
			);
		}
		const { book, chapter, verse, translation } = parsed.data;

		// Reject coordinates that are inside the allowed ranges but not in the
		// Bible, so the queue can never hold a card with no verse to show.
		const text = await learnVerseText(translation, book, chapter, verse);
		if (!text) {
			return NextResponse.json({ error: "That verse does not exist." }, { status: 400 });
		}

		const { card, created } = await addCard(userId, parsed.data);
		return NextResponse.json(card, { status: created ? 201 : 200 });
	} catch (error) {
		if (error instanceof Response) return error;
		console.error("[api/learn] POST failed", error);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
