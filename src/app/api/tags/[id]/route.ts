import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
	try {
		const userId = await getAuthUser();
		const { id } = await params;
		const existing = await prisma.tag.findFirst({
			where: { id, userId },
		});
		if (!existing) {
			return NextResponse.json({ error: "Not found" }, { status: 404 });
		}

		// Cascade: NoteTag entries deleted via Prisma cascade
		await prisma.tag.delete({ where: { id } });
		return NextResponse.json({ success: true });
	} catch (err) {
		if (err instanceof Response) return err;
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
