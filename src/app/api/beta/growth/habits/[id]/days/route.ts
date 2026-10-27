import { requireBetaApi } from "@/lib/beta/access";
import { growthTimezone, setHabitDay } from "@/lib/beta/growth/growth";
import { growthBody, growthFailure, growthJson, growthNotFound, growthRequestTimezone } from "@/lib/beta/growth/http";

/**
 * PUT /api/beta/growth/habits/:id/days?tz=<IANA> { day: "YYYY-MM-DD", done: boolean }
 * Marks or clears one day of a habit kept by hand (prayer, custom). Habits
 * SureWord counts from what the founder does answer 400: never typed twice.
 */
export const dynamic = "force-dynamic";

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	try {
		const { id } = await params;
		const timezone = await growthTimezone(gate.userId, growthRequestTimezone(request));
		return (await setHabitDay(gate.userId, id, await growthBody(request), timezone)) ? growthJson({ ok: true }) : growthNotFound();
	} catch (error) {
		return growthFailure(error, "/habits/:id/days");
	}
}
