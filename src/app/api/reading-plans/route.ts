import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthUser } from "@/lib/auth";
import { MAX_PLAN_DAYS, MIN_PLAN_DAYS } from "@/lib/reading-plan-presets";
import { ReadingPlanError, getReadingPlansView, startPlan } from "@/lib/reading-plans";

/** A goal the user typed, long enough to be specific, short enough to be a goal. */
const MAX_GOAL_LENGTH = 300;

// Writing a plan is one structured utility-model call over the study context.
export const maxDuration = 120;

const startSchema = z.union([
	z.object({ presetKey: z.string().min(1).max(60) }),
	z.object({
		goal: z.string().min(1).max(MAX_GOAL_LENGTH),
		days: z.number().int().min(MIN_PLAN_DAYS).max(MAX_PLAN_DAYS),
	}),
]);

/**
 * The reading-plan screen's opening call: the plan the caller is following
 * (with progress) plus the presets they could start.
 */
export async function GET(): Promise<Response> {
	try {
		const userId = await getAuthUser();
		return NextResponse.json(await getReadingPlansView(userId));
	} catch (error) {
		return errorResponse(error);
	}
}

/**
 * Start a plan: `{ presetKey }` for one of ours, or `{ goal, days }` to have
 * one written for them. Either way the plan they were on is archived first -
 * one plan at a time, on every client and from chat.
 */
export async function POST(req: Request): Promise<Response> {
	try {
		const userId = await getAuthUser();

		const parsed = startSchema.safeParse(await req.json().catch(() => null));
		if (!parsed.success) {
			return NextResponse.json(
				{
					error: `Send either { presetKey } or { goal, days } with days between ${MIN_PLAN_DAYS} and ${MAX_PLAN_DAYS}.`,
				},
				{ status: 400 }
			);
		}

		return NextResponse.json(await startPlan(userId, parsed.data));
	} catch (error) {
		return errorResponse(error);
	}
}

function errorResponse(error: unknown): Response {
	if (error instanceof Response) return error;
	// Something the user asked for wrongly is theirs to correct, not a 500.
	if (error instanceof ReadingPlanError) {
		return NextResponse.json({ error: error.message }, { status: 400 });
	}
	console.error("[api/reading-plans] request failed", error);
	return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}
