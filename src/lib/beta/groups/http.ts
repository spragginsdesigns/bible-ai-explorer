import "server-only";

import { betaNotFound } from "@/lib/beta/access";
import { roomJson } from "@/lib/beta/rooms/http";
import { getGroupView } from "@/lib/beta/groups/groups";

/** After a change, the group as the caller now sees it (404 once they have left). */
export async function groupViewResponse(userId: string, groupId: string): Promise<Response> {
	const group = await getGroupView(userId, groupId);
	return group ? roomJson({ group }) : betaNotFound();
}
