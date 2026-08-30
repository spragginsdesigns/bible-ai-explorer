import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { waitUntil } from "@vercel/functions";
import { prisma } from "@/lib/prisma";
import { getAuthUser, getAuthUserId } from "@/lib/auth";
import { syncNoteEmbeddings } from "@/lib/note-embeddings";
import {
	type NoteProperties,
	resolvePendingLinks,
	syncNoteLinks,
	validateAliases,
	validateProperties,
} from "@/lib/note-links";

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

		// Single round trip: the userId guard lives in the update itself
		// (extendedWhereUnique) instead of a separate findFirst.
		const note = await prisma.note.update({
			where: { id, userId },
			data: {
				...(body.title !== undefined && { title: body.title }),
				...(body.content !== undefined && { content: body.content }),
				...(body.htmlContent !== undefined && { htmlContent: body.htmlContent }),
				...(body.plainText !== undefined && { plainText: body.plainText }),
				...(aliases !== undefined && { aliases }),
				...(properties !== undefined && { properties: properties ?? Prisma.DbNull }),
				...(body.folderId !== undefined && { folderId: body.folderId }),
				...(body.isPinned !== undefined && { isPinned: body.isPinned }),
				...(body.wordCount !== undefined && { wordCount: body.wordCount }),
			},
			include: { tags: { include: { tag: true } } },
		});
		// Awaited, unlike the embeddings below: the editor re-reads links right
		// after a save, so a deferred sync would show the previous set.
		if (body.plainText !== undefined) {
			await syncNoteLinks({ userId, noteId: note.id, plainText: note.plainText });
		}
		// A rename or a new alias can only resolve links, never unresolve them.
		if (body.title !== undefined || aliases !== undefined) {
			await resolvePendingLinks({
				userId,
				noteId: note.id,
				title: note.title,
				aliases: note.aliases,
			});
		}
		// Keep the semantic note index in step with content changes, off the
		// response path — a failed sync only degrades AI note search.
		if (body.title !== undefined || body.plainText !== undefined) {
			waitUntil(
				syncNoteEmbeddings({
					userId,
					noteId: note.id,
					title: note.title,
					plainText: note.plainText,
				})
			);
		}
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
