import { requireBetaApi } from "@/lib/beta/access";
import { deletePost } from "@/lib/beta/rooms/rooms";
import { roomErrorResponse, roomViewResponse } from "@/lib/beta/rooms/http";

/** DELETE /api/beta/rooms/:id/posts/:postId -> { room }: by its author or the owner. */
export const dynamic = "force-dynamic";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; postId: string }> }) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	try {
		const { id, postId } = await params;
		await deletePost(gate.userId, id, postId);
		return await roomViewResponse(gate.userId, id);
	} catch (error) {
		return roomErrorResponse(error, "delete post");
	}
}
