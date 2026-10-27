import { requireBetaApi } from "@/lib/beta/access";
import { readJson, roomErrorResponse } from "@/lib/beta/rooms/http";
import { deleteGroupPost, updateGroupPost } from "@/lib/beta/groups/groups";
import { groupViewResponse } from "@/lib/beta/groups/http";

/**
 * PATCH  -> { group }: a session's { step?, notes?, end? } (the leader running
 * it), or a prayer's { prayed } (anyone but the asker) or { answered, answer? }
 * (the asker).
 * DELETE -> { group }: removes the post and everything under it.
 */
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; postId: string }> };

export async function PATCH(req: Request, { params }: Params) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	try {
		const { id, postId } = await params;
		await updateGroupPost(gate.userId, id, postId, await readJson(req));
		return await groupViewResponse(gate.userId, id);
	} catch (error) {
		return roomErrorResponse(error, "groups update post");
	}
}

export async function DELETE(_req: Request, { params }: Params) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	try {
		const { id, postId } = await params;
		await deleteGroupPost(gate.userId, id, postId);
		return await groupViewResponse(gate.userId, id);
	} catch (error) {
		return roomErrorResponse(error, "groups delete post");
	}
}
