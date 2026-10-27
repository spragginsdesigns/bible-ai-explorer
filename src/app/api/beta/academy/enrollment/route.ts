import { requireBetaApi } from "@/lib/beta/access";
import { enroll, leave } from "@/lib/beta/academy/academy";
import { academyJson, academyServerError, courseIdOf } from "@/lib/beta/academy/http";

export const dynamic = "force-dynamic";

/**
 * SureWord Academy enrollment (LC-17660, docs/beta/academy.md).
 * POST   { courseId }  enroll in a course; 201 the first time, 200 after.
 * DELETE ?courseId=    leave the course, which is also how it is started over.
 * Founders only; everyone else gets the ordinary 404.
 */
export async function POST(req: Request) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	const body = (await req.json().catch(() => null)) as { courseId?: unknown } | null;
	const courseId = courseIdOf(body?.courseId);
	if (!courseId) return academyJson({ error: "Send { courseId }." }, 400);
	try {
		const result = await enroll(gate.userId, courseId);
		if ("error" in result) return academyJson({ error: result.error }, result.status);
		return academyJson(result, result.created ? 201 : 200);
	} catch (error) {
		return academyServerError("enrollment", error);
	}
}

export async function DELETE(req: Request) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	const courseId = courseIdOf(new URL(req.url).searchParams.get("courseId"));
	if (!courseId) return academyJson({ error: "Send ?courseId=<course>." }, 400);
	try {
		const result = await leave(gate.userId, courseId);
		if ("error" in result) return academyJson({ error: result.error }, result.status);
		return result.left ? academyJson(result) : academyJson({ error: "Not found" }, 404);
	} catch (error) {
		return academyServerError("enrollment", error);
	}
}
