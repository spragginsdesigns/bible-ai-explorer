import { requireBetaApi } from "@/lib/beta/access";
import { vaultFailure, vaultJson } from "@/lib/beta/vault/http";
import { vaultTimeline } from "@/lib/beta/vault/timeline";

/**
 * GET /api/beta/vault/timeline?subject=Romans 8 (a passage, or a topic such as
 * "grace"; `passage` and `topic` force one reading): one subject, oldest first.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	try {
		const params = new URL(req.url).searchParams;
		const passage = params.get("passage")?.trim().slice(0, 40) || null;
		const topic = params.get("topic")?.trim().slice(0, 60) || null;
		const subject = params.get("subject")?.trim().slice(0, 60) || null;
		return vaultJson(await vaultTimeline(gate.userId, { subject, passage, topic }));
	} catch (error) {
		return vaultFailure(error, "/timeline", "That history could not be loaded just now.");
	}
}
