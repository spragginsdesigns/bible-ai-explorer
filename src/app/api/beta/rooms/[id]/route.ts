import { betaNotFound, requireBetaApi } from "@/lib/beta/access";
import { getRoomView, updateRoom } from "@/lib/beta/rooms/rooms";
import { readJson, roomErrorResponse, roomJson, roomViewResponse } from "@/lib/beta/rooms/http";

/**
 * GET   /api/beta/rooms/:id -> { room }, for its members only.
 * PATCH /api/beta/rooms/:id { name?, description?, archived?, planPresetKey? }
 * -> { room }, for its owner only (docs/beta/rooms.md).
 */
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	try {
		const room = await getRoomView(gate.userId, (await params).id);
		return room ? roomJson({ room }) : betaNotFound();
	} catch (error) {
		return roomErrorResponse(error, "view");
	}
}

export async function PATCH(req: Request, { params }: Params) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	try {
		const { id } = await params;
		await updateRoom(gate.userId, id, await readJson(req));
		return await roomViewResponse(gate.userId, id);
	} catch (error) {
		return roomErrorResponse(error, "update");
	}
}
