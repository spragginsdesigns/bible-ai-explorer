import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { readReviewedHistoryList } from "@/lib/ai/history/read-boundary.server";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
	try {
		const userId = await getAuthUser();
		const { id } = await params;
		const batch = await readReviewedHistoryList(userId, "note", id);
		if (!batch) return NextResponse.json({ error: "Not found" }, { status: 404 });
		return NextResponse.json(batch.rows, { headers: { "Cache-Control": "private, no-store" } });
	} catch (err) {
		if (err instanceof Response) return err;
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
	try {
		const userId = await getAuthUser();
		const { id } = await params;
		const note = await prisma.note.findFirst({
			where: { id, userId },
		});
		if (!note) {
			return NextResponse.json({ error: "Not found" }, { status: 404 });
		}

		const body = await req.json();
		// Assistant history is written only by the checked server stream.
		if (body?.role !== "user" || typeof body.content !== "string" || !body.content.trim() || body.content.length > 50_000) {
			return NextResponse.json({ error: "A user message of 1 to 50000 characters is required." }, { status: 400 });
		}
		const message = await prisma.noteAIMessage.create({
			data: {
				noteId: id,
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

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
	try {
		const userId = await getAuthUser();
		const { id } = await params;
		const note = await prisma.note.findFirst({
			where: { id, userId },
		});
		if (!note) {
			return NextResponse.json({ error: "Not found" }, { status: 404 });
		}

		await prisma.$transaction(async db => {
			// Keep receipts, but fence pending startup/onEnd history writes before
			// deleting. Their operation-row locks serialize with this update.
			await db.noteAIOperation.updateMany({ where: { userId, noteId: id }, data: { state: "cancelled" } });
			await db.noteAIMessage.deleteMany({ where: { noteId: id } });
		});
		return NextResponse.json({ success: true });
	} catch (err) {
		if (err instanceof Response) return err;
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
