import { getAuthUser } from "@/lib/auth";
import { requireBetaApi } from "@/lib/beta/access";
import { createRoom, listRooms } from "@/lib/beta/rooms/rooms";
import { readJson, roomErrorResponse, roomJson } from "@/lib/beta/rooms/http";
import { FAMILY_PURPOSE } from "@/lib/beta/family/family";
import { familyViewResponse } from "@/lib/beta/family/http";

/**
 * GET  /api/beta/family -> { families }: every family the caller is a parent in.
 * POST /api/beta/family { name, displayName } -> { family }: a new family, a
 * Study Room of purpose "family", with the caller as its owner
 * (docs/beta/family.md).
 */
export const dynamic = "force-dynamic";

export async function GET() {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	try {
		return roomJson({ families: await listRooms(gate.userId, FAMILY_PURPOSE) });
	} catch (error) {
		return roomErrorResponse(error, "family list");
	}
}

export async function POST(req: Request) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	try {
		// The room's foreign keys need the founder's User row to exist.
		await getAuthUser();
		const familyId = await createRoom(gate.userId, await readJson(req), FAMILY_PURPOSE);
		return await familyViewResponse(gate.userId, familyId);
	} catch (error) {
		return roomErrorResponse(error, "family create");
	}
}
