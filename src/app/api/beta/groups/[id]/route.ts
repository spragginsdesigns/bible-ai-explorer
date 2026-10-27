import { betaNotFound, requireBetaApi } from "@/lib/beta/access";
import { updateRoom } from "@/lib/beta/rooms/rooms";
import { readJson, roomErrorResponse, roomJson } from "@/lib/beta/rooms/http";
import { GROUP_PURPOSE, getGroupView } from "@/lib/beta/groups/groups";
import { groupViewResponse } from "@/lib/beta/groups/http";

/**
 * GET   /api/beta/groups/:id -> { group }, for its members only.
 * PATCH /api/beta/groups/:id { name?, description?, archived?, planPresetKey? }
 * -> { group }, for its owner only, through Study Rooms' updateRoom
 * (docs/beta/groups.md).
 */
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	try {
		const group = await getGroupView(gate.userId, (await params).id);
		return group ? roomJson({ group }) : betaNotFound();
	} catch (error) {
		return roomErrorResponse(error, "groups view");
	}
}

export async function PATCH(req: Request, { params }: Params) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	try {
		const { id } = await params;
		await updateRoom(gate.userId, id, await readJson(req), GROUP_PURPOSE);
		return await groupViewResponse(gate.userId, id);
	} catch (error) {
		return roomErrorResponse(error, "groups update");
	}
}
