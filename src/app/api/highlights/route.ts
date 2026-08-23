import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const verseKey = {
	translation: z.string().min(1).max(20),
	book: z.number().int().min(1).max(66), // canonical order, 1-66
	chapter: z.number().int().min(1).max(200),
	verse: z.number().int().min(1).max(200),
};

const querySchema = z.object({
	translation: verseKey.translation,
	book: z.coerce.number().int().min(1).max(66),
	chapter: z.coerce.number().int().min(1).max(200),
});

const putSchema = z.object({
	...verseKey,
	color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
});

const deleteSchema = z.object(verseKey);

/**
 * List the caller's highlights for one chapter of one translation.
 */
export async function GET(req: Request) {
	try {
		const userId = await getAuthUser();

		const { searchParams } = new URL(req.url);
		const parsed = querySchema.safeParse({
			translation: searchParams.get("translation"),
			book: searchParams.get("book"),
			chapter: searchParams.get("chapter"),
		});
		if (!parsed.success) {
			return NextResponse.json(
				{ error: "Invalid input: 'translation', 'book' and 'chapter' are required." },
				{ status: 400 }
			);
		}
		const { translation, book, chapter } = parsed.data;

		const rows = await prisma.verseHighlight.findMany({
			where: { userId, translation, book, chapter },
			select: { verse: true, color: true },
			orderBy: { verse: "asc" },
		});

		return NextResponse.json({ highlights: rows });
	} catch (error) {
		if (error instanceof Response) return error;
		console.error("[api/highlights] GET failed", error);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}

/**
 * Create or replace the caller's highlight on one verse (one highlight per
 * verse per translation, so a re-pick just changes the color).
 */
export async function PUT(req: Request) {
	try {
		const userId = await getAuthUser();

		const parsed = putSchema.safeParse(await req.json().catch(() => null));
		if (!parsed.success) {
			return NextResponse.json(
				{ error: "Invalid input: verse key and a '#RRGGBB' color are required." },
				{ status: 400 }
			);
		}
		const { translation, book, chapter, verse, color } = parsed.data;

		const highlight = await prisma.verseHighlight.upsert({
			where: {
				userId_translation_book_chapter_verse: { userId, translation, book, chapter, verse },
			},
			update: { color },
			create: { userId, translation, book, chapter, verse, color },
		});

		return NextResponse.json(highlight);
	} catch (error) {
		if (error instanceof Response) return error;
		console.error("[api/highlights] PUT failed", error);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}

/**
 * Remove the caller's highlight from one verse. Idempotent: deleting a verse
 * with no highlight still succeeds.
 */
export async function DELETE(req: Request) {
	try {
		const userId = await getAuthUser();

		const parsed = deleteSchema.safeParse(await req.json().catch(() => null));
		if (!parsed.success) {
			return NextResponse.json(
				{ error: "Invalid input: 'translation', 'book', 'chapter' and 'verse' are required." },
				{ status: 400 }
			);
		}
		const { translation, book, chapter, verse } = parsed.data;

		await prisma.verseHighlight.deleteMany({
			where: { userId, translation, book, chapter, verse },
		});

		return NextResponse.json({ removed: true });
	} catch (error) {
		if (error instanceof Response) return error;
		console.error("[api/highlights] DELETE failed", error);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
