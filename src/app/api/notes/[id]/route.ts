import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getAuthUser, getAuthUserId } from "@/lib/auth";

function isNotFound(err: unknown): boolean {
	return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025";
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
	try {
		const userId = await getAuthUserId();
		const { id } = await params;
		// AI messages load through /api/notes/[id]/ai-messages; including them
		// here made every editor open carry the whole chat history.
		const note = await prisma.note.findFirst({
			where: { id, userId },
			include: { tags: { include: { tag: true } } },
		});
		if (!note) {
			return NextResponse.json({ error: "Not found" }, { status: 404 });
		}
		return NextResponse.json(note);
	} catch (err) {
		if (err instanceof Response) return err;
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
	try {
		const userId = await getAuthUser();
		const { id } = await params;
		const body = await req.json();

		// Single round trip: the userId guard lives in the update itself
		// (extendedWhereUnique) instead of a separate findFirst.
		const note = await prisma.note.update({
			where: { id, userId },
			data: {
				...(body.title !== undefined && { title: body.title }),
				...(body.content !== undefined && { content: body.content }),
				...(body.htmlContent !== undefined && { htmlContent: body.htmlContent }),
				...(body.plainText !== undefined && { plainText: body.plainText }),
				...(body.folderId !== undefined && { folderId: body.folderId }),
				...(body.isPinned !== undefined && { isPinned: body.isPinned }),
				...(body.wordCount !== undefined && { wordCount: body.wordCount }),
			},
			include: { tags: { include: { tag: true } } },
		});
		return NextResponse.json(note);
	} catch (err) {
		if (err instanceof Response) return err;
		if (isNotFound(err)) {
			return NextResponse.json({ error: "Not found" }, { status: 404 });
		}
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
	try {
		const userId = await getAuthUser();
		const { id } = await params;
		await prisma.note.delete({ where: { id, userId } });
		return NextResponse.json({ success: true });
	} catch (err) {
		if (err instanceof Response) return err;
		if (isNotFound(err)) {
			return NextResponse.json({ error: "Not found" }, { status: 404 });
		}
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
