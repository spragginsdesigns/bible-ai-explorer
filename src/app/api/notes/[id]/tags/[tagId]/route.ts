import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";

export async function POST(
	_req: Request,
	{ params }: { params: { id: string; tagId: string } }
) {
	try {
		const userId = await getAuthUser();
		// Verify note ownership
		const note = await prisma.note.findFirst({
			where: { id: params.id, userId },
		});
		if (!note) {
			return NextResponse.json({ error: "Note not found" }, { status: 404 });
		}
		// Verify tag ownership
		const tag = await prisma.tag.findFirst({
			where: { id: params.tagId, userId },
		});
		if (!tag) {
			return NextResponse.json({ error: "Tag not found" }, { status: 404 });
		}

		// Toggle: if exists, remove; if not, add
		const existing = await prisma.noteTag.findUnique({
			where: { noteId_tagId: { noteId: params.id, tagId: params.tagId } },
		});

		if (existing) {
			await prisma.noteTag.delete({
				where: { noteId_tagId: { noteId: params.id, tagId: params.tagId } },
			});
			return NextResponse.json({ action: "removed" });
		} else {
			await prisma.noteTag.create({
				data: { noteId: params.id, tagId: params.tagId },
			});
			return NextResponse.json({ action: "added" }, { status: 201 });
		}
	} catch (err) {
		if (err instanceof Response) return err;
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
