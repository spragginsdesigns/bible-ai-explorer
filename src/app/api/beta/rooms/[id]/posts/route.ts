import { requireBetaApi } from "@/lib/beta/access";
import { addPost } from "@/lib/beta/rooms/rooms";
import { readJson, roomErrorResponse, roomViewResponse } from "@/lib/beta/rooms/http";

/**
 * POST /api/beta/rooms/:id/posts -> { room }. A member adds a passage
 * `{ kind: "passage", reference, body? }`, a question `{ kind: "question",
 * body, reference? }`, a note `{ kind: "note", title?, body, reference? }` or a
 * copy of one of their own notes `{ kind: "note", noteId }`, or a reply
 * `{ kind: "reply", parentId, body }` (docs/beta/rooms.md).
 */
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	try {
		const { id } = await params;
		await addPost(gate.userId, id, await readJson(req));
		return await roomViewResponse(gate.userId, id);
	} catch (error) {
		return roomErrorResponse(error, "post");
	}
}
