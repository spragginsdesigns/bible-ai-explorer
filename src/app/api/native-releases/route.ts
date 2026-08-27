import { NextResponse } from "next/server";
import { FALLBACK_NATIVE_RELEASES, getNativeReleases } from "@/lib/native-releases";

export const revalidate = 300;
const cacheHeaders = {
	"Cache-Control": "public, s-maxage=300, stale-while-revalidate=86400",
};

/** Current downloadable native builds, discovered independently per platform. */
export async function GET(): Promise<Response> {
	try {
		return NextResponse.json(await getNativeReleases(), { headers: cacheHeaders });
	} catch (error) {
		console.error("[api/native-releases] GitHub lookup failed", error);
		return NextResponse.json(FALLBACK_NATIVE_RELEASES, { headers: cacheHeaders });
	}
}
