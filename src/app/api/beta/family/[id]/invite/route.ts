import { requireBetaApi } from "@/lib/beta/access";
import { setInvite } from "@/lib/beta/rooms/rooms";
import { roomErrorResponse } from "@/lib/beta/rooms/http";
import { FAMILY_PURPOSE } from "@/lib/beta/family/family";
import { familyViewResponse } from "@/lib/beta/family/http";

/**
 * The family's invite link, for its owner: Study Rooms' own link (a fresh
 * random slug on POST, off on DELETE), opening /beta/together/family/join/<slug>.
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
		await setInvite(gate.userId, id, on, FAMILY_PURPOSE);
		return await familyViewResponse(gate.userId, id);
	} catch (error) {
		return roomErrorResponse(error, on ? "family invite" : "family revoke");
	}
}
