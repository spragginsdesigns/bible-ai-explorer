import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
	try {
		const userId = await getAuthUser();
		const conversation = await prisma.conversation.findFirst({
			where: { id: params.id, userId },
			include: {
				messages: { orderBy: { createdAt: "asc" } },
			},
		});
		if (!conversation) {
			return NextResponse.json({ error: "Not found" }, { status: 404 });
		}
		return NextResponse.json(conversation);
	} catch (err) {
		if (err instanceof Response) return err;
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
	try {
		const userId = await getAuthUser();
		const conversation = await prisma.conversation.findFirst({
			where: { id: params.id, userId },
		});
		if (!conversation) {
			return NextResponse.json({ error: "Not found" }, { status: 404 });
		}
		await prisma.conversation.delete({ where: { id: params.id } });
		return NextResponse.json({ success: true });
	} catch (err) {
		if (err instanceof Response) return err;
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
