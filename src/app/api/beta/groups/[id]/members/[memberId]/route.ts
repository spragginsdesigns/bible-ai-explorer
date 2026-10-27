import { requireBetaApi } from "@/lib/beta/access";
import { removeMember, setMemberRole } from "@/lib/beta/rooms/rooms";
import { readJson, roomErrorResponse, roomJson } from "@/lib/beta/rooms/http";
import { GROUP_PURPOSE } from "@/lib/beta/groups/groups";
import { groupViewResponse } from "@/lib/beta/groups/http";

/**
 * PATCH  /api/beta/groups/:id/members/:memberId { role: "leader" | "member" }
 * -> { group }: the owner names a leader, or makes one a member again.
 * DELETE: the owner or a leader removes a member (-> { group }), or a member
 * leaves (-> { left: true }); their posts in the group go with them.
 */
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; memberId: string }> };

export async function PATCH(req: Request, { params }: Params) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	try {
		const { id, memberId } = await params;
		await setMemberRole(gate.userId, id, memberId, await readJson(req), GROUP_PURPOSE);
		return await groupViewResponse(gate.userId, id);
	} catch (error) {
		return roomErrorResponse(error, "groups role");
	}
}

export async function DELETE(_req: Request, { params }: Params) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	try {
		const { id, memberId } = await params;
		const action = await removeMember(gate.userId, id, memberId, GROUP_PURPOSE);
		return action === "leave" ? roomJson({ left: true }) : await groupViewResponse(gate.userId, id);
	} catch (error) {
		return roomErrorResponse(error, "groups remove member");
	}
}
