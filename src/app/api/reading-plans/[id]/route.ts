import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { ReadingPlanError, archivePlan, getReadingPlansView } from "@/lib/reading-plans";

/**
 * Put a plan away. Nothing is deleted - the plan and its ticked days stay as
 * history - so the response is simply the screen's new state: no active plan,
 * and the presets to choose from.
 */
export async function DELETE(
	_req: Request,
	{ params }: { params: Promise<{ id: string }> }
): Promise<Response> {
	try {
		const userId = await getAuthUser();
		const { id } = await params;
		await archivePlan(userId, id);
		return NextResponse.json(await getReadingPlansView(userId));
	} catch (error) {
		if (error instanceof Response) return error;
		if (error instanceof ReadingPlanError) {
			return NextResponse.json({ error: error.message }, { status: 400 });
		}
		console.error("[api/reading-plans/:id] DELETE failed", error);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
