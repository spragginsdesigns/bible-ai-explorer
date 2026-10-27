import { requireBetaApi } from "@/lib/beta/access";
import { CHUNK_MAX_SECONDS, CHUNK_SAMPLE_RATE, WAV_HEADER_BYTES } from "@/lib/beta/sermons/sermons-rules";
import { sermonsFailure, sermonsJson, sermonsServerError } from "@/lib/beta/sermons/http";
import { addSermonPiece, isSermonsError } from "@/lib/beta/sermons/server";

export const dynamic = "force-dynamic";
// One Whisper call on at most 110 seconds of audio.
export const maxDuration = 60;

type Params = { params: Promise<{ sermonId: string }> };

/** The largest piece the browser makes, with a little room: 16 kHz mono 16-bit for 111 seconds. */
const MAX_BYTES = WAV_HEADER_BYTES + (CHUNK_MAX_SECONDS + 1) * CHUNK_SAMPLE_RATE * 2;

/**
 * POST /api/beta/sermons/<id>/pieces?index=<n> (Sermon to Study, LC-17643):
 * transcribe the next piece of the recording, sent as a 16 kHz mono WAV body.
 * Pieces go in order; a repeated piece is answered without paying for it
 * again. This is the only route that spends (Whisper, per audio minute), and
 * only on the founder's own upload or recording.
 */
export async function POST(req: Request, { params }: Params) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	const index = Number(new URL(req.url).searchParams.get("index"));
	if (!Number.isInteger(index) || index < 0 || index > 1000) return sermonsJson({ error: "Say which piece this is." }, 400);
	const declared = Number(req.headers.get("content-length") ?? 0);
	if (declared > MAX_BYTES) return sermonsJson({ error: "That audio piece is too large." }, 413);
	try {
		const bytes = new Uint8Array(await req.arrayBuffer());
		if (bytes.byteLength > MAX_BYTES) return sermonsJson({ error: "That audio piece is too large." }, 413);
		const result = await addSermonPiece(gate.userId, (await params).sermonId, index, bytes);
		return isSermonsError(result) ? sermonsFailure(result) : sermonsJson(result);
	} catch (error) {
		return sermonsServerError("pieces", error, "That part of the sermon could not be transcribed. Please try again.");
	}
}
