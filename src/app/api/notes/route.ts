import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser, getAuthUserId } from "@/lib/auth";

// Summary payloads omit the heavy content/htmlContent columns - list views
// only need metadata + plainText, and full rows can make the list response
// orders of magnitude larger.
const NOTE_SUMMARY_SELECT = {
	id: true,
	title: true,
	plainText: true,
	folderId: true,
	isPinned: true,
	wordCount: true,
	createdAt: true,
	updatedAt: true,
	tags: { include: { tag: true } },
} as const;

export async function GET(req: Request) {
	try {
		const userId = await getAuthUserId();
		const { searchParams } = new URL(req.url);
		const folderId = searchParams.get("folderId");
		const tagId = searchParams.get("tagId");
		const summary = searchParams.get("summary") === "1";

		const where = {
			userId,
			...(folderId && { folderId }),
			...(tagId && { tags: { some: { tagId } } }),
		};
		const orderBy = { updatedAt: "desc" as const };

		const notes = summary
			? await prisma.note.findMany({ where, orderBy, select: NOTE_SUMMARY_SELECT })
			: await prisma.note.findMany({
					where,
					orderBy,
					include: { tags: { include: { tag: true } } },
				});
		return NextResponse.json(notes);
	} catch (err) {
		if (err instanceof Response) return err;
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}

export async function POST(req: Request) {
	try {
		const userId = await getAuthUser();
		const body = await req.json();
		const note = await prisma.note.create({
			data: {
				title: body.title || "Untitled Note",
				content: body.content || "",
				htmlContent: body.htmlContent || "",
				plainText: body.plainText || "",
				folderId: body.folderId || null,
				userId,
				isPinned: false,
				wordCount: body.wordCount || 0,
			},
			include: { tags: { include: { tag: true } } },
		});
		return NextResponse.json(note, { status: 201 });
	} catch (err) {
		if (err instanceof Response) return err;
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
