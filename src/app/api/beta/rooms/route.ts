import { getAuthUser } from "@/lib/auth";
import { requireBetaApi } from "@/lib/beta/access";
import { createRoom, listRooms } from "@/lib/beta/rooms/rooms";
import { readJson, roomErrorResponse, roomJson, roomViewResponse } from "@/lib/beta/rooms/http";

/**
 * GET  /api/beta/rooms -> { rooms }: every Study Room the caller is in.
 * POST /api/beta/rooms { name, description?, displayName } -> { room }: a new
 * room with the caller as its owner (docs/beta/rooms.md).
 */
export const dynamic = "force-dynamic";

export async function GET() {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	try {
		return roomJson({ rooms: await listRooms(gate.userId) });
	} catch (error) {
		return roomErrorResponse(error, "list");
	}
}

export async function POST(req: Request) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	try {
		// The room's foreign keys need the founder's User row to exist.
		await getAuthUser();
		const roomId = await createRoom(gate.userId, await readJson(req));
		return await roomViewResponse(gate.userId, roomId);
	} catch (error) {
		return roomErrorResponse(error, "create");
	}
}
