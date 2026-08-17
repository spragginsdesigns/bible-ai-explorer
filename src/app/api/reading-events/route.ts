import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const eventSchema = z.object({
	book: z.string().min(1).max(50),
	chapter: z.number().int().min(1).max(200),
	translation: z.string().min(1).max(20).optional(),
});

const DEDUPE_WINDOW_MS = 60 * 60 * 1000;

/**
 * Record that the caller read a chapter. Intentionally dumb: the clients
 * debounce (a few seconds on screen before posting) and we skip the insert
 * when the same user/book/chapter was already recorded within the last hour,
 * so re-opening a chapter does not inflate the reading history.
 */
export async function POST(req: Request) {
	try {
		const userId = await getAuthUser();

		const parsed = eventSchema.safeParse(await req.json().catch(() => null));
		if (!parsed.success) {
			return NextResponse.json(
				{ error: "Invalid input: 'book' and 'chapter' are required." },
				{ status: 400 }
			);
		}
		const { book, chapter, translation } = parsed.data;

		const recent = await prisma.readingEvent.findFirst({
			where: {
				userId,
				book,
				chapter,
				readAt: { gte: new Date(Date.now() - DEDUPE_WINDOW_MS) },
			},
			select: { id: true },
		});
		if (recent) {
			return NextResponse.json({ recorded: false });
		}

		await prisma.readingEvent.create({
			data: { userId, book, chapter, translation: translation ?? "KJV" },
		});

		return NextResponse.json({ recorded: true });
	} catch (error) {
		if (error instanceof Response) return error;
		console.error("[api/reading-events] POST failed", error);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
