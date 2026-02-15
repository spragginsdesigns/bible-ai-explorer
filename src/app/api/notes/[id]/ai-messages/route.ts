import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
	try {
		const userId = await getAuthUser();
		const note = await prisma.note.findFirst({
			where: { id: params.id, userId },
		});
		if (!note) {
			return NextResponse.json({ error: "Not found" }, { status: 404 });
		}

		const messages = await prisma.noteAIMessage.findMany({
			where: { noteId: params.id },
			orderBy: { createdAt: "asc" },
		});
		return NextResponse.json(messages);
	} catch (err) {
		if (err instanceof Response) return err;
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
	try {
		const userId = await getAuthUser();
		const note = await prisma.note.findFirst({
			where: { id: params.id, userId },
		});
		if (!note) {
			return NextResponse.json({ error: "Not found" }, { status: 404 });
		}

		const body = await req.json();
		const message = await prisma.noteAIMessage.create({
			data: {
				noteId: params.id,
				role: body.role,
				content: body.content,
			},
		});
		return NextResponse.json(message, { status: 201 });
	} catch (err) {
		if (err instanceof Response) return err;
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
	try {
		const userId = await getAuthUser();
		const note = await prisma.note.findFirst({
			where: { id: params.id, userId },
		});
		if (!note) {
			return NextResponse.json({ error: "Not found" }, { status: 404 });
		}

		await prisma.noteAIMessage.deleteMany({
			where: { noteId: params.id },
		});
		return NextResponse.json({ success: true });
	} catch (err) {
		if (err instanceof Response) return err;
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
