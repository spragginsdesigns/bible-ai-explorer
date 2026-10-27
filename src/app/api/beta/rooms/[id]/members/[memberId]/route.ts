import { requireBetaApi } from "@/lib/beta/access";
import { removeMember } from "@/lib/beta/rooms/rooms";
import { roomErrorResponse, roomJson, roomViewResponse } from "@/lib/beta/rooms/http";

/**
 * DELETE /api/beta/rooms/:id/members/:memberId: the owner removes a member
 * (-> { room }), or a member removes themself, leaving (-> { left: true }).
 * Either way that member's posts in the room are deleted with them.
 */
export const dynamic = "force-dynamic";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; memberId: string }> }) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	try {
		const { id, memberId } = await params;
		const action = await removeMember(gate.userId, id, memberId);
		return action === "leave" ? roomJson({ left: true }) : await roomViewResponse(gate.userId, id);
	} catch (error) {
		return roomErrorResponse(error, "remove member");
	}
}
