import "server-only";

import { betaNotFound } from "@/lib/beta/access";
import { roomJson } from "@/lib/beta/rooms/http";
import { getFamilyView } from "@/lib/beta/family/family";

/** After a change, the family as the caller now sees it (404 once they have left). */
export async function familyViewResponse(userId: string, familyId: string): Promise<Response> {
	const family = await getFamilyView(userId, familyId);
	return family ? roomJson({ family }) : betaNotFound();
}
