import { NextResponse } from "next/server";
import { getAuthUserId } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
	SUREWORD_AI_LABEL,
	SUREWORD_PLAN_MODEL_IDS,
	sureWordPlanDefinition,
	sureWordPlanForModelId,
	toModelPayload,
} from "@/lib/ai/models";
import { aiAccessFor, houseChatModel, isServerCredentialUser } from "@/lib/ai/provider";
import { houseEffortFor, houseEffortsFor } from "@/lib/ai/access";

export const maxDuration = 30;

const HOUSE_NOTE = "Included with SureWord.";

/**
 * The single source every client (web, Android, macOS) renders its model
 * picker from.
 *
 * An account with no key of its own is in `house` mode: it runs on SureWord's
 * key, on one model, and the response says so with a single-entry list and no
 * providers, so a picker has nothing to render but the house note.
 *
 * The owner gets the two plans' SureWord AIs. Personal API keys, and the full
 * provider model list they unlocked, were removed on 2026-10-25.
 */
export async function GET(): Promise<Response> {
	try {
		const userId = await getAuthUserId();
		const [access, user] = await Promise.all([
			aiAccessFor(userId),
			prisma.user.findUnique({
				where: { id: userId },
				select: { defaultModelId: true },
			}),
		]);

		if (access === "house") {
			const { definition: house, plan } = await houseChatModel(userId);
			// The plan sets the effort and neither plan chooses it, so `efforts` is
			// empty and clients render no Reasoning chips.
			const efforts = houseEffortsFor(plan).filter((effort) => house.efforts.includes(effort));
			const preferred = houseEffortFor(null, plan);
			const houseEffort = house.efforts.includes(preferred) ? preferred : null;
			// Both plans read "SureWord AI"; Pro carries the premium mark instead
			// of a second name, so no included surface names the head.
			const label = SUREWORD_AI_LABEL;
			const premium = plan === "pro";
			// The house entry carries the same capability fields as any other. A
			// client renders the Reasoning chips from `house.efforts` (empty for both
			// plans since 2026-10-25, absent on servers before 2026-10-08) and no
			// other options.
			return NextResponse.json({
				access,
				providers: [],
				models: [{ ...toModelPayload(house), label, premium }],
				defaults: {
					modelId: house.id,
					effort: houseEffort,
					speed: null,
					verbosity: null,
					mode: null,
				},
				house: {
					modelId: house.id,
					label,
					premium,
					effort: houseEffort,
					efforts,
					note: HOUSE_NOTE,
				},
			});
		}

		// The owner chooses between the two plans' SureWord AIs, not models
		// (Austin, 2026-10-25), under one "SureWord" provider header. Neither
		// row offers run options; resolveModel's owner branch runs the pick.
		if (isServerCredentialUser(userId)) {
			const plan = sureWordPlanForModelId(user?.defaultModelId) ?? "pro";
			return NextResponse.json({
				access,
				providers: [{ id: "sureword", label: "SureWord", available: true }],
				models: (["free", "pro"] as const).map((rowPlan) => ({
					...toModelPayload(sureWordPlanDefinition(rowPlan)),
					provider: "sureword",
					premium: rowPlan === "pro",
				})),
				defaults: { modelId: SUREWORD_PLAN_MODEL_IDS[plan], effort: null, speed: null, verbosity: null, mode: null },
				house: null,
			});
		}

		// Unreachable today: the owner is the only `keys` account. Kept as a
		// plain answer rather than a model list so a misconfigured allowlist
		// can never resurrect the old provider picker.
		return NextResponse.json({ error: "No AI plan is available for this account." }, { status: 409 });
	} catch (error) {
		if (error instanceof Response) return error;
		console.error("[api/ai/models] GET failed", error);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
