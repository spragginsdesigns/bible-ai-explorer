import { getAuthUser } from "@/lib/auth";
import { betaNotFound, requireBetaApi } from "@/lib/beta/access";
import { joinRoom, previewInvite } from "@/lib/beta/rooms/rooms";
import { readJson, roomErrorResponse, roomJson } from "@/lib/beta/rooms/http";
import { GROUP_PURPOSE } from "@/lib/beta/groups/groups";

/**
 * A group's invite link: Study Rooms' own. GET -> { invite }; POST
 * { displayName } -> { roomId }. A study room's link is the ordinary 404
 * here, and a group's link is one at Study Rooms' join route.
 */
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ token: string }> };

export async function GET(_req: Request, { params }: Params) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	try {
		const invite = await previewInvite(gate.userId, (await params).token, new Date(), GROUP_PURPOSE);
		return invite ? roomJson({ invite }) : betaNotFound();
	} catch (error) {
		return roomErrorResponse(error, "groups preview invite");
	}
}

export async function POST(req: Request, { params }: Params) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	try {
		// Membership's foreign key needs the founder's User row to exist.
		await getAuthUser();
		const roomId = await joinRoom(gate.userId, (await params).token, await readJson(req), GROUP_PURPOSE);
		return roomJson({ roomId });
	} catch (error) {
		return roomErrorResponse(error, "groups join");
	}
}
