import { NextResponse } from "next/server";
import { BETA_PRIVATE_HEADERS, requireBetaApi } from "@/lib/beta/access";
import { getPersonStudies } from "@/lib/beta/atlas/studies";
import { errorTag } from "@/lib/beta/vault/search";

/**
 * GET /api/beta/atlas/studies?person=<id> (LC-17725, docs/beta/atlas.md): the
 * signed-in founder's own studies that touch a person's passages, found by
 * the Knowledge Vault's passage search over every chapter of that life.
 * Founders only, and only `gate.userId`'s vault; read-only.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export async function GET(req: Request) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;

	const id = new URL(req.url).searchParams.get("person") ?? "";
	if (id.length > 80 || !ID.test(id)) {
		return NextResponse.json({ error: "Ask for one person by their id." }, { status: 400, headers: BETA_PRIVATE_HEADERS });
	}
	try {
		const studies = await getPersonStudies(gate.userId, id);
		if (!studies) return NextResponse.json({ error: "Not found" }, { status: 404, headers: BETA_PRIVATE_HEADERS });
		return NextResponse.json(studies, { headers: BETA_PRIVATE_HEADERS });
	} catch (error) {
		console.error("[beta/atlas] studies failed", errorTag(error));
		return NextResponse.json({ error: "Your studies could not be read just now." }, { status: 500, headers: BETA_PRIVATE_HEADERS });
	}
}
