import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { waitUntil } from "@vercel/functions";
import { prisma } from "@/lib/prisma";
import { getAuthUser, getAuthUserId } from "@/lib/auth";
import { syncNoteEmbeddings } from "@/lib/note-embeddings";
import {
	resolvePendingLinks,
	syncNoteLinks,
	validateAliases,
	validateProperties,
} from "@/lib/note-links";

// Summary payloads omit the heavy content/htmlContent columns - list views
// only need metadata + plainText, and full rows can make the list response
// orders of magnitude larger. `aliases` is in because clients resolve
// wikilink autocomplete off the cached list; `properties` stays out.
const NOTE_SUMMARY_SELECT = {
	id: true,
	title: true,
	plainText: true,
	aliases: true,
	folderId: true,
	isPinned: true,
	wordCount: true,
	createdAt: true,
	updatedAt: true,
	tags: { include: { tag: true } },
} as const;

export async function GET(req: Request) {
	try {
		const userId = await getAuthUserId();
		const { searchParams } = new URL(req.url);
		const folderId = searchParams.get("folderId");
		const tagId = searchParams.get("tagId");
		const summary = searchParams.get("summary") === "1";

		const where = {
			userId,
			...(folderId && { folderId }),
			...(tagId && { tags: { some: { tagId } } }),
		};
		const orderBy = { updatedAt: "desc" as const };

		const notes = summary
			? await prisma.note.findMany({ where, orderBy, select: NOTE_SUMMARY_SELECT })
			: await prisma.note.findMany({
					where,
					orderBy,
					include: { tags: { include: { tag: true } } },
				});
		return NextResponse.json(notes);
	} catch (err) {
		if (err instanceof Response) return err;
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}

export async function POST(req: Request) {
	try {
		const userId = await getAuthUser();
		const body = await req.json();

		const aliases = validateAliases(body.aliases ?? []);
		if (!aliases.ok) {
			return NextResponse.json({ error: aliases.error }, { status: 400 });
		}
		const properties = validateProperties(body.properties ?? null);
		if (!properties.ok) {
			return NextResponse.json({ error: properties.error }, { status: 400 });
		}

		const note = await prisma.note.create({
			data: {
				title: body.title || "Untitled Note",
				content: body.content || "",
				htmlContent: body.htmlContent || "",
				plainText: body.plainText || "",
				aliases: aliases.value,
				properties: properties.value ?? Prisma.DbNull,
				folderId: body.folderId || null,
				userId,
				isPinned: false,
				wordCount: body.wordCount || 0,
			},
			include: { tags: { include: { tag: true } } },
		});
		// Links are awaited, not deferred: the client renders them straight after
		// the create, and a new note also claims the links already pointing at
		// its title.
		if (note.plainText) {
			await syncNoteLinks({ userId, noteId: note.id, plainText: note.plainText });
		}
		await resolvePendingLinks({
			userId,
			noteId: note.id,
			title: note.title,
			aliases: note.aliases,
		});
		if (note.plainText) {
			waitUntil(
				syncNoteEmbeddings({
					userId,
					noteId: note.id,
					title: note.title,
					plainText: note.plainText,
				})
			);
		}
		return NextResponse.json(note, { status: 201 });
	} catch (err) {
		if (err instanceof Response) return err;
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
