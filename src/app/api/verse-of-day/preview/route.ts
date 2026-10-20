import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { findTodayCross } from "@/lib/daily-cross";

const PRIVATE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" };

/** Today can show an existing word without generating, replacing or charging for one. */
export async function GET(): Promise<Response> {
	try {
		const userId = await getAuthUser();
		const cross = await findTodayCross(userId);
		return NextResponse.json({
			cross: cross ? {
				id: cross.id,
				reference: `${cross.book} ${cross.chapter}:${cross.verse}`,
				book: cross.book,
				chapter: cross.chapter,
				verse: cross.verse,
				text: cross.text,
				sentAt: cross.sentAt.toISOString(),
			} : null,
		}, { headers: PRIVATE_HEADERS });
	} catch (error) {
		if (error instanceof Response) return error;
		return NextResponse.json(
			{ error: "Could not load today's word. Open the devotional to try again." },
			{ status: 500, headers: PRIVATE_HEADERS },
		);
	}
}
