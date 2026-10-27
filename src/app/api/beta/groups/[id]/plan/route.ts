import { requireBetaApi } from "@/lib/beta/access";
import { followPlan, unfollowPlan } from "@/lib/beta/rooms/rooms";
import { readJson, roomErrorResponse } from "@/lib/beta/rooms/http";
import { GROUP_PURPOSE } from "@/lib/beta/groups/groups";
import { groupViewResponse } from "@/lib/beta/groups/http";

/**
 * The caller follows the group's reading plan (POST { replacePlanId? }), which
 * makes it their own ReadingPlan from the group's day 1, or stops sharing
 * their progress (DELETE): Study Rooms' own plan, nothing beside it.
 */
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Params) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	try {
		const { id } = await params;
		await followPlan(gate.userId, id, await readJson(req), GROUP_PURPOSE);
		return await groupViewResponse(gate.userId, id);
	} catch (error) {
		return roomErrorResponse(error, "groups follow");
	}
}

export async function DELETE(_req: Request, { params }: Params) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	try {
		const { id } = await params;
		await unfollowPlan(gate.userId, id, GROUP_PURPOSE);
		return await groupViewResponse(gate.userId, id);
	} catch (error) {
		return roomErrorResponse(error, "groups unfollow");
	}
}
