import { requireBetaApi } from "@/lib/beta/access";
import { readBody, sermonsFailure, sermonsJson, sermonsServerError } from "@/lib/beta/sermons/http";
import { createSermon, isSermonsError, sermonCards } from "@/lib/beta/sermons/server";

export const dynamic = "force-dynamic";

/** GET /api/beta/sermons (Sermon to Study, LC-17643): the founder's saved sermons, newest first. */
export async function GET() {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	try {
		return sermonsJson({ sermons: await sermonCards(gate.userId) });
	} catch (error) {
		return sermonsServerError("list", error, "Your sermons could not be loaded.");
	}
}

/**
 * POST /api/beta/sermons: start a sermon from `{ title, preacher, permission,
 * source, fileName, durationSec }`. Refused unless `permission` is true (the
 * founder confirmed they may use the recording). Spends nothing: the pieces
 * are transcribed one request at a time after this.
 */
export async function POST(req: Request) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	const body = await readBody(req);
	if (!body) return sermonsJson({ error: "Send the sermon's details." }, 400);
	try {
		const result = await createSermon(gate.userId, {
			title: body.title,
			preacher: body.preacher,
			permission: body.permission,
			source: body.source,
			fileName: body.fileName,
			durationSec: body.durationSec,
		});
		return isSermonsError(result) ? sermonsFailure(result) : sermonsJson(result, 201);
	} catch (error) {
		return sermonsServerError("create", error, "The sermon could not be started.");
	}
}
