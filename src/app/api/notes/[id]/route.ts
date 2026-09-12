import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { waitUntil } from "@vercel/functions";
import { prisma } from "@/lib/prisma";
import { getAuthUser, getAuthUserId } from "@/lib/auth";
import { patchUserNote } from "@/lib/notes-io";
import { type NoteProperties, validateAliases, validateProperties } from "@/lib/note-links";

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

		let aliases: string[] | undefined;
		if (body.aliases !== undefined) {
			const parsed = validateAliases(body.aliases);
			if (!parsed.ok) {
				return NextResponse.json({ error: parsed.error }, { status: 400 });
			}
			aliases = parsed.value;
		}
		let properties: NoteProperties | null | undefined;
		if (body.properties !== undefined) {
			const parsed = validateProperties(body.properties);
			if (!parsed.ok) {
				return NextResponse.json({ error: parsed.error }, { status: 400 });
			}
			properties = parsed.value;
		}

		// The userId guard lives in the update itself, so a missing or foreign
		// note surfaces as P2025 below; embeddings sync off the response path.
		const note = await patchUserNote(
			userId,
			id,
			{
				title: body.title,
				content: body.content,
				htmlContent: body.htmlContent,
				plainText: body.plainText,
				aliases,
				properties,
				folderId: body.folderId,
				isPinned: body.isPinned,
				wordCount: body.wordCount,
			},
			{ deferEmbeddings: waitUntil }
		);
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
		// NoteEmbedding rows go with the note via the FK cascade.
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
