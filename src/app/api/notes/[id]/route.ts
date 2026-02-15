import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
	try {
		const userId = await getAuthUser();
		const note = await prisma.note.findFirst({
			where: { id: params.id, userId },
			include: { tags: { include: { tag: true } }, aiMessages: { orderBy: { createdAt: "asc" } } },
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

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
	try {
		const userId = await getAuthUser();
		const existing = await prisma.note.findFirst({
			where: { id: params.id, userId },
		});
		if (!existing) {
			return NextResponse.json({ error: "Not found" }, { status: 404 });
		}

		const body = await req.json();
		const note = await prisma.note.update({
			where: { id: params.id },
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
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
	try {
		const userId = await getAuthUser();
		const existing = await prisma.note.findFirst({
			where: { id: params.id, userId },
		});
		if (!existing) {
			return NextResponse.json({ error: "Not found" }, { status: 404 });
		}
		await prisma.note.delete({ where: { id: params.id } });
		return NextResponse.json({ success: true });
	} catch (err) {
		if (err instanceof Response) return err;
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
