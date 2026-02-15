import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";

export async function GET(req: Request) {
	try {
		const userId = await getAuthUser();
		const { searchParams } = new URL(req.url);
		const folderId = searchParams.get("folderId");
		const tagId = searchParams.get("tagId");

		const notes = await prisma.note.findMany({
			where: {
				userId,
				...(folderId && { folderId }),
				...(tagId && { tags: { some: { tagId } } }),
			},
			include: { tags: { include: { tag: true } } },
			orderBy: { updatedAt: "desc" },
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
