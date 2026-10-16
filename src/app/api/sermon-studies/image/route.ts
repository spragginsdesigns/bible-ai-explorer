import { get } from "@vercel/blob";
import { NextResponse } from "next/server";
import { isSignedSermonImage } from "@/lib/sermon-studies";

/**
 * One sermon-study illustration, streamed from the private Blob store through
 * our own origin.
 *
 * Public in the middleware on purpose: an RN `Image` and a plain `<img>` send no
 * session header. The credential is the `s` HMAC that only the session-scoped
 * study API hands out (see `withSignedImage`), so this cannot be walked to read
 * another church's artwork, and it serves nothing outside `sermons/`.
 *
 * The URL never changes for a given picture, so it is cached hard: the phone's
 * image cache and the CDN keep it, and a study reopened later costs nothing.
 */
const CACHE_CONTROL = "public, max-age=604800, s-maxage=2592000";

export async function GET(req: Request) {
	const params = new URL(req.url).searchParams;
	const pathname = params.get("p") ?? "";
	if (!isSignedSermonImage(pathname, params.get("s") ?? "")) {
		return NextResponse.json({ error: "Not found" }, { status: 404 });
	}
	try {
		const result = await get(pathname, { access: "private" });
		if (!result || result.statusCode !== 200) {
			return NextResponse.json({ error: "Not found" }, { status: 404 });
		}
		return new Response(result.stream, {
			status: 200,
			headers: {
				"Content-Type": result.blob.contentType,
				"Cache-Control": CACHE_CONTROL,
				...(result.blob.size ? { "Content-Length": String(result.blob.size) } : {}),
			},
		});
	} catch (error) {
		console.error("[sermon-studies/image] GET failed", error);
		return NextResponse.json({ error: "That picture could not be loaded." }, { status: 500 });
	}
}
