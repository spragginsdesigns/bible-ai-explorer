import { requireBetaApi } from "@/lib/beta/access";
import { followPlan, unfollowPlan } from "@/lib/beta/rooms/rooms";
import { readJson, roomErrorResponse, roomViewResponse } from "@/lib/beta/rooms/http";

/**
 * The caller follows the room's reading plan (POST { replacePlanId? }), which
 * makes it their own reading plan from the room's day 1, or stops sharing
 * their progress (DELETE). A 409 with `replace: { id, title }` asks them to
 * confirm replacing the plan they are on (docs/beta/rooms.md).
 */
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Params) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	try {
		const { id } = await params;
		await followPlan(gate.userId, id, await readJson(req));
		return await roomViewResponse(gate.userId, id);
	} catch (error) {
		return roomErrorResponse(error, "follow");
	}
}

export async function DELETE(_req: Request, { params }: Params) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	try {
		const { id } = await params;
		await unfollowPlan(gate.userId, id);
		return await roomViewResponse(gate.userId, id);
	} catch (error) {
		return roomErrorResponse(error, "unfollow");
	}
}
