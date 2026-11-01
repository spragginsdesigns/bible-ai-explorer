import { requireBetaApi } from "@/lib/beta/access";
import { readJson, roomErrorResponse } from "@/lib/beta/rooms/http";
import { addFamilyChild } from "@/lib/beta/family/family";
import { familyViewResponse } from "@/lib/beta/family/http";

/**
 * POST /api/beta/family/:id/children { childId } -> { family }: a parent adds
 * one of their own SureWord Kids profiles to the family (docs/beta/family.md).
 * Another parent's profile id reads like one that does not exist.
 */
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Params) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	try {
		const { id } = await params;
		await addFamilyChild(gate.userId, id, await readJson(req));
		return await familyViewResponse(gate.userId, id);
	} catch (error) {
		return roomErrorResponse(error, "family add child");
	}
}
