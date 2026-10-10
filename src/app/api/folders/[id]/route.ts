import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
	try {
		const userId = await getAuthUser();
		const { id } = await params;
		const existing = await prisma.folder.findFirst({
			where: { id, userId },
		});
		if (!existing) {
			return NextResponse.json({ error: "Not found" }, { status: 404 });
		}

		const { name } = await req.json();
		const folder = await prisma.folder.update({
			where: { id },
			data: { name },
		});
		return NextResponse.json(folder);
	} catch (err) {
		if (err instanceof Response) return err;
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
	try {
		const userId = await getAuthUser();
		const { id } = await params;
		const existing = await prisma.folder.findFirst({
			where: { id, userId },
		});
		if (!existing) {
			return NextResponse.json({ error: "Not found" }, { status: 404 });
		}

		// Unfile the folder's notes, then delete it, together. The database no
		// longer unfiles them itself: the (folderId, userId) key is NO ACTION.
		await prisma.$transaction([
			prisma.note.updateMany({
				where: { folderId: id, userId },
				data: { folderId: null },
			}),
			prisma.folder.delete({ where: { id, userId } }),
		]);
		return NextResponse.json({ success: true });
	} catch (err) {
		if (err instanceof Response) return err;
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
