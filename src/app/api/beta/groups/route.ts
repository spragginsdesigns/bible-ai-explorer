import { getAuthUser } from "@/lib/auth";
import { requireBetaApi } from "@/lib/beta/access";
import { createRoom, listRooms } from "@/lib/beta/rooms/rooms";
import { readJson, roomErrorResponse, roomJson } from "@/lib/beta/rooms/http";
import { GROUP_PURPOSE } from "@/lib/beta/groups/groups";
import { groupViewResponse } from "@/lib/beta/groups/http";

/**
 * GET  /api/beta/groups -> { groups }: every SureWord Group the caller is in.
 * POST /api/beta/groups { name, description?, displayName } -> { group }: a new
 * group, a Study Room of purpose "group", with the caller as its owner
 * (docs/beta/groups.md).
 */
export const dynamic = "force-dynamic";

export async function GET() {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	try {
		return roomJson({ groups: await listRooms(gate.userId, GROUP_PURPOSE) });
	} catch (error) {
		return roomErrorResponse(error, "groups list");
	}
}

export async function POST(req: Request) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	try {
		// The room's foreign keys need the founder's User row to exist.
		await getAuthUser();
		const groupId = await createRoom(gate.userId, await readJson(req), GROUP_PURPOSE);
		return await groupViewResponse(gate.userId, groupId);
	} catch (error) {
		return roomErrorResponse(error, "groups create");
	}
}
