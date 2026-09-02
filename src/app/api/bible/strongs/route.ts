import { NextResponse } from "next/server";
import { lookupStrongsEntry } from "@/lib/bible/originals";

export const maxDuration = 10;

// Same reasoning as /api/bible/original: public-domain dictionary data bundled
// with the deploy, requested once per Strong's number a reader taps.
const cacheHeaders = {
	"Cache-Control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400",
};

const STRONGS_NUMBER = /^[HG]\d{1,5}$/;

/**
 * One Strong's Hebrew or Greek dictionary entry. Public for the same reason as
 * the original-language verse route: public-domain reference data, no user state.
 */
export async function GET(req: Request): Promise<Response> {
	try {
		const raw = new URL(req.url).searchParams.get("number")?.trim().toUpperCase() ?? "";
		if (!STRONGS_NUMBER.test(raw)) {
			return NextResponse.json({ error: "invalid_number" }, { status: 400 });
		}

		// Word records carry zero-padded numbers ("H0430") but the dictionary is
		// keyed unpadded, so normalize before echoing the number back to callers.
		const number = raw.replace(/^([HG])0+(?=\d)/, "$1");

		const entry = await lookupStrongsEntry(number);
		if (!entry) {
			return NextResponse.json({ error: "not_found" }, { status: 404, headers: cacheHeaders });
		}

		return NextResponse.json(
			{
				number,
				lemma: entry.lemma,
				translit: entry.translit,
				def: entry.def,
				kjv: entry.kjv,
			},
			{ headers: cacheHeaders }
		);
	} catch (error) {
		console.error("[api/bible/strongs] request failed", error);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
