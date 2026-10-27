import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthUser } from "@/lib/auth";
import { BETA_PRIVATE_HEADERS, requireBetaApi } from "@/lib/beta/access";
import { MemoryInputError, addMemoryPassage, rangeFromReference } from "@/lib/beta/memory/memory";

const addSchema = z
	.object({
		reference: z.string().trim().min(1).max(80),
		// Learn a verse's own sources: a highlight, a suggestion from study, or a verse picked by hand.
		source: z.enum(["highlight", "suggestion", "sheet"]),
	})
	.strict();

/**
 * POST /api/beta/memory/cards `{ reference, source }`: add a verse or a
 * passage of up to six verses to Learn a verse's queue (docs/beta/memory.md).
 * Each verse goes through Learn a verse's `addCard`, so adding one that is
 * already there changes nothing; a passage is also kept as one unit.
 */
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	try {
		const parsed = addSchema.safeParse(await req.json().catch(() => null));
		if (!parsed.success) {
			return NextResponse.json(
				{ error: "Send a 'reference' such as Ephesians 2:8-9 and a 'source' of highlight, suggestion or sheet." },
				{ status: 400, headers: BETA_PRIVATE_HEADERS },
			);
		}
		// The same session; this makes sure the account row a card hangs on exists.
		if ((await getAuthUser()) !== gate.userId) {
			return NextResponse.json({ error: "Not found" }, { status: 404, headers: BETA_PRIVATE_HEADERS });
		}
		const result = await addMemoryPassage(gate.userId, rangeFromReference(parsed.data.reference), parsed.data.source);
		return NextResponse.json(result, { status: result.added > 0 ? 201 : 200, headers: BETA_PRIVATE_HEADERS });
	} catch (error) {
		if (error instanceof Response) return error;
		if (error instanceof MemoryInputError) {
			return NextResponse.json({ error: error.message }, { status: error.status, headers: BETA_PRIVATE_HEADERS });
		}
		console.error("[api/beta/memory/cards] POST failed", error);
		return NextResponse.json({ error: "Internal server error" }, { status: 500, headers: BETA_PRIVATE_HEADERS });
	}
}
