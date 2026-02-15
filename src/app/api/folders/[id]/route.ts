import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
	try {
		const userId = await getAuthUser();
		const existing = await prisma.folder.findFirst({
			where: { id: params.id, userId },
		});
		if (!existing) {
			return NextResponse.json({ error: "Not found" }, { status: 404 });
		}

		const { name } = await req.json();
		const folder = await prisma.folder.update({
			where: { id: params.id },
			data: { name },
		});
		return NextResponse.json(folder);
	} catch (err) {
		if (err instanceof Response) return err;
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
	try {
		const userId = await getAuthUser();
		const existing = await prisma.folder.findFirst({
			where: { id: params.id, userId },
		});
		if (!existing) {
			return NextResponse.json({ error: "Not found" }, { status: 404 });
		}

		// Move notes in this folder to unfiled
		await prisma.note.updateMany({
			where: { folderId: params.id },
			data: { folderId: null },
		});
		await prisma.folder.delete({ where: { id: params.id } });
		return NextResponse.json({ success: true });
	} catch (err) {
		if (err instanceof Response) return err;
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
