import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUserId } from "@/lib/auth";

/**
 * The note's link graph, both directions.
 *
 * Outgoing entries keep their raw typed text and carry a null noteId when the
 * target does not exist yet, so the client can render an unresolved link
 * without a second lookup. Backlinks carry the snippet captured at parse time.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
	try {
		const userId = await getAuthUserId();
		const { id } = await params;

		const note = await prisma.note.findFirst({
			where: { id, userId },
			select: { id: true },
		});
		if (!note) {
			return NextResponse.json({ error: "Not found" }, { status: 404 });
		}

		const [outgoing, backlinks] = await Promise.all([
			prisma.noteLink.findMany({
				where: { sourceNoteId: id },
				orderBy: { targetKey: "asc" },
				select: {
					targetTitle: true,
					target: { select: { id: true, title: true } },
				},
			}),
			prisma.noteLink.findMany({
				where: { targetNoteId: id },
				orderBy: { source: { updatedAt: "desc" } },
				select: {
					snippet: true,
					source: { select: { id: true, title: true, updatedAt: true } },
				},
			}),
		]);

		return NextResponse.json({
			outgoing: outgoing.map((link) => ({
				targetTitle: link.targetTitle,
				noteId: link.target?.id ?? null,
				title: link.target?.title ?? null,
			})),
			backlinks: backlinks.map((link) => ({
				noteId: link.source.id,
				title: link.source.title,
				snippet: link.snippet,
				updatedAt: link.source.updatedAt.toISOString(),
			})),
		});
	} catch (err) {
		if (err instanceof Response) return err;
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
