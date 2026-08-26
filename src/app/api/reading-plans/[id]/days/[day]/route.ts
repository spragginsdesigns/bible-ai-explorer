import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthUser } from "@/lib/auth";
import { ReadingPlanError, setDayDone } from "@/lib/reading-plans";

const bodySchema = z.object({ done: z.boolean() });

/**
 * Tick or untick one day of a plan by hand - the escape hatch for reading done
 * outside SureWord. Days read *in* the app need no call at all: they fill in
 * from the user's `ReadingEvent` history.
 *
 * Answers the whole plan with fresh progress, so a client never has to guess
 * what the tick did to the streak or the percentage.
 */
export async function POST(
	req: Request,
	{ params }: { params: Promise<{ id: string; day: string }> }
): Promise<Response> {
	try {
		const userId = await getAuthUser();
		const { id, day } = await params;

		const parsed = bodySchema.safeParse(await req.json().catch(() => null));
		if (!parsed.success) {
			return NextResponse.json({ error: "Send { done: true } or { done: false }." }, { status: 400 });
		}

		const dayNumber = Number(day);
		if (!Number.isInteger(dayNumber)) {
			return NextResponse.json({ error: "The day must be a whole number." }, { status: 400 });
		}

		return NextResponse.json(await setDayDone(userId, id, dayNumber, parsed.data.done));
	} catch (error) {
		if (error instanceof Response) return error;
		if (error instanceof ReadingPlanError) {
			return NextResponse.json({ error: error.message }, { status: 400 });
		}
		console.error("[api/reading-plans/:id/days/:day] POST failed", error);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
