import { requireBetaApi } from "@/lib/beta/access";
import { roomErrorResponse } from "@/lib/beta/rooms/http";
import { prepareWeek } from "@/lib/beta/groups/groups";
import { groupViewResponse } from "@/lib/beta/groups/http";

/**
 * POST /api/beta/groups/:id/posts/:weekId/prepare -> { group }: a leader asks
 * SureWord to draft discussion questions on the week's passage. The only AI
 * call in Groups, made only on this request, at most three times a week.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(_req: Request, { params }: { params: Promise<{ id: string; postId: string }> }) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	try {
		const { id, postId } = await params;
		await prepareWeek(gate.userId, id, postId);
		return await groupViewResponse(gate.userId, id);
	} catch (error) {
		return roomErrorResponse(error, "groups prepare");
	}
}
