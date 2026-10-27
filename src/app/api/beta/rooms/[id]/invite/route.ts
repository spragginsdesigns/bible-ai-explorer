import { requireBetaApi } from "@/lib/beta/access";
import { setInvite } from "@/lib/beta/rooms/rooms";
import { roomErrorResponse, roomViewResponse } from "@/lib/beta/rooms/http";

/**
 * The room's invite link, for its owner (docs/beta/rooms.md). The slug is the
 * capability: POST turns the link on with a fresh slug (so a new link always
 * retires the old one), DELETE turns it off. Members already in stay in.
 */
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function POST(_req: Request, { params }: Params) {
	return change(params, true);
}

export async function DELETE(_req: Request, { params }: Params) {
	return change(params, false);
}

async function change(params: Params["params"], on: boolean) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	try {
		const { id } = await params;
		await setInvite(gate.userId, id, on);
		return await roomViewResponse(gate.userId, id);
	} catch (error) {
		return roomErrorResponse(error, on ? "invite" : "revoke");
	}
}
