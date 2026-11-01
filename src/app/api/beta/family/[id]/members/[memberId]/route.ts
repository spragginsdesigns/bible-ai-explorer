import { requireBetaApi } from "@/lib/beta/access";
import { removeMember } from "@/lib/beta/rooms/rooms";
import { roomErrorResponse, roomJson } from "@/lib/beta/rooms/http";
import { FAMILY_PURPOSE } from "@/lib/beta/family/family";
import { familyViewResponse } from "@/lib/beta/family/http";

/**
 * DELETE /api/beta/family/:id/members/:memberId: the owner removes a parent
 * (-> { family }), or a parent leaves (-> { left: true }), through Study
 * Rooms' removeMember. The children they added leave the family with them;
 * their Kids profiles stay on their account.
 */
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; memberId: string }> };

export async function DELETE(_req: Request, { params }: Params) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	try {
		const { id, memberId } = await params;
		const action = await removeMember(gate.userId, id, memberId, FAMILY_PURPOSE);
		return action === "leave" ? roomJson({ left: true }) : await familyViewResponse(gate.userId, id);
	} catch (error) {
		return roomErrorResponse(error, "family remove member");
	}
}
