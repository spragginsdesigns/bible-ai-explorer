import { requireBetaApi } from "@/lib/beta/access";
import { DISMISSED_LINK_KIND } from "@/lib/beta/graph/graph-rules";
import { graphFailure, graphJson, readObject } from "@/lib/beta/graph/http";
import { getBetaLink, linkBetaItems, unlinkBetaItems } from "@/lib/beta/store";

/**
 * PATCH /api/beta/graph/links/<id> `{ action: "accept" | "dismiss" }`: the
 * founder's answer to a suggested connection. Accepting makes it theirs
 * (`origin: "user"`, reason kept); dismissing removes it and remembers the
 * pair as `not-related`, so it is never suggested again. Only suggestions can
 * be answered; any other id is a 404. Founders only; everyone else 404s.
 */
export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	try {
		const { id } = await params;
		const action = (await readObject(req)).action;
		if (action !== "accept" && action !== "dismiss") return graphJson({ error: "action must be accept or dismiss" }, 400);
		const link = await getBetaLink(gate.userId, id);
		if (!link || link.origin !== "suggested") return graphJson({ error: "Not found" }, 404);
		if (action === "accept") {
			await linkBetaItems(gate.userId, { fromId: link.fromId, toId: link.toId, kind: link.kind, reason: link.reason, origin: "user" });
		} else {
			await unlinkBetaItems(gate.userId, link.id);
			await linkBetaItems(gate.userId, { fromId: link.fromId, toId: link.toId, kind: DISMISSED_LINK_KIND, reason: link.reason, origin: "user" });
		}
		return graphJson({ ok: true });
	} catch (error) {
		return graphFailure(error, "/links", "That connection could not be updated just now. Please try again.");
	}
}
