import { NextResponse } from "next/server";
import { BETA_PRIVATE_HEADERS, requireBetaApi } from "@/lib/beta/access";
import { getPersonLife } from "@/lib/beta/atlas/atlas";

/**
 * GET /api/beta/atlas/person?id=<person> (LC-17725, docs/beta/atlas.md): one
 * person's life in order, every event with its places and its verses from the
 * bundled KJV, fetched once when the person is chosen so playing it never
 * waits. Founders only; read-only bundled data.
 */
export const dynamic = "force-dynamic";

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export async function GET(req: Request) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;

	const id = new URL(req.url).searchParams.get("id") ?? "";
	if (id.length > 80 || !ID.test(id)) {
		return NextResponse.json({ error: "Ask for one person by their id." }, { status: 400, headers: BETA_PRIVATE_HEADERS });
	}
	const person = await getPersonLife(id);
	if (!person) return NextResponse.json({ error: "Not found" }, { status: 404, headers: BETA_PRIVATE_HEADERS });
	return NextResponse.json({ person }, { headers: BETA_PRIVATE_HEADERS });
}
