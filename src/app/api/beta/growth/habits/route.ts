import { requireBetaApi } from "@/lib/beta/access";
import { createHabit, createStarterHabits } from "@/lib/beta/growth/growth";
import { STARTER_HABIT_TYPES } from "@/lib/beta/growth/growth-rules";
import { growthBody, growthFailure, growthJson } from "@/lib/beta/growth/http";

/**
 * POST /api/beta/growth/habits
 *   { type, name?, target?, reminder? } -> { id }: one habit.
 *   { starter: true } -> { created }: Bible reading, prayer and Scripture memory, skipping any already there.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	try {
		const body = await growthBody(request);
		if (body.starter === true) return growthJson({ created: await createStarterHabits(gate.userId, STARTER_HABIT_TYPES) }, 201);
		return growthJson({ id: await createHabit(gate.userId, body) }, 201);
	} catch (error) {
		return growthFailure(error, "/habits");
	}
}
