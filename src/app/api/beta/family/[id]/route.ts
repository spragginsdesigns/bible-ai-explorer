import { betaNotFound, requireBetaApi } from "@/lib/beta/access";
import { updateRoom } from "@/lib/beta/rooms/rooms";
import { readJson, roomErrorResponse, roomJson } from "@/lib/beta/rooms/http";
import { FAMILY_PURPOSE, getFamilyView } from "@/lib/beta/family/family";
import { familyViewResponse } from "@/lib/beta/family/http";

/**
 * GET   /api/beta/family/:id -> { family }, for its parents only.
 * PATCH /api/beta/family/:id { name?, description?, archived? } -> { family },
 * for its owner only, through Study Rooms' updateRoom (docs/beta/family.md).
 */
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	try {
		const family = await getFamilyView(gate.userId, (await params).id);
		return family ? roomJson({ family }) : betaNotFound();
	} catch (error) {
		return roomErrorResponse(error, "family view");
	}
}

export async function PATCH(req: Request, { params }: Params) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	try {
		const { id } = await params;
		const body = await readJson(req);
		// A family has no group reading plan yet: only its name, line and archive.
		const patch = body && typeof body === "object" ? { ...(body as Record<string, unknown>), planPresetKey: undefined } : body;
		await updateRoom(gate.userId, id, patch, FAMILY_PURPOSE);
		return await familyViewResponse(gate.userId, id);
	} catch (error) {
		return roomErrorResponse(error, "family update");
	}
}
