import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthUser } from "@/lib/auth";
import { reviewCardById } from "@/lib/learn";

const reviewSchema = z.object({ result: z.enum(["again", "good"]) });

/**
 * Record one review and hand back the card as it now stands. The lookup is
 * userId-scoped, so another user's id is a 404 rather than a write.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
	try {
		const userId = await getAuthUser();
		const { id } = await params;

		const parsed = reviewSchema.safeParse(await req.json().catch(() => null));
		if (!parsed.success) {
			return NextResponse.json(
				{ error: "Invalid input: 'result' must be 'again' or 'good'." },
				{ status: 400 }
			);
		}

		const card = await reviewCardById(userId, id, parsed.data.result);
		if (!card) {
			return NextResponse.json({ error: "Not found" }, { status: 404 });
		}
		return NextResponse.json(card);
	} catch (error) {
		if (error instanceof Response) return error;
		console.error("[api/learn/:id/review] POST failed", error);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
