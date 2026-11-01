import { requireBetaApi } from "@/lib/beta/access";
import { roomErrorResponse } from "@/lib/beta/rooms/http";
import { removeFamilyChild } from "@/lib/beta/family/family";
import { familyViewResponse } from "@/lib/beta/family/http";

/**
 * DELETE /api/beta/family/:id/children/:linkId -> { family }: the parent who
 * added a child, or the owner, takes them out of the family. Their Kids
 * profile and its stars are untouched.
 */
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; linkId: string }> };

export async function DELETE(_req: Request, { params }: Params) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	try {
		const { id, linkId } = await params;
		await removeFamilyChild(gate.userId, id, linkId);
		return await familyViewResponse(gate.userId, id);
	} catch (error) {
		return roomErrorResponse(error, "family remove child");
	}
}
