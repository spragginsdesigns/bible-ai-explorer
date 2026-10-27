import { getAuthUser } from "@/lib/auth";
import { betaNotFound, requireBetaApi } from "@/lib/beta/access";
import { joinRoom, previewInvite } from "@/lib/beta/rooms/rooms";
import { readJson, roomErrorResponse, roomJson } from "@/lib/beta/rooms/http";

/**
 * An invite link (docs/beta/rooms.md). GET -> { invite } shows what it opens
 * onto; POST { displayName } -> { roomId } joins. A revoked, replaced or
 * archived room's link is the ordinary 404, and so is any link for an account
 * off BETA_USER_IDS: the beta gate comes first.
 */
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ token: string }> };

export async function GET(_req: Request, { params }: Params) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	try {
		const invite = await previewInvite(gate.userId, (await params).token);
		return invite ? roomJson({ invite }) : betaNotFound();
	} catch (error) {
		return roomErrorResponse(error, "preview invite");
	}
}

export async function POST(req: Request, { params }: Params) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	try {
		// Membership's foreign key needs the founder's User row to exist.
		await getAuthUser();
		const roomId = await joinRoom(gate.userId, (await params).token, await readJson(req));
		return roomJson({ roomId });
	} catch (error) {
		return roomErrorResponse(error, "join");
	}
}
