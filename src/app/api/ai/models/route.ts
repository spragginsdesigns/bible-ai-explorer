import { NextResponse } from "next/server";
import { getAuthUserId } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { DEFAULT_MODEL_ID, getModel, isReasoningEffort, MODELS } from "@/lib/ai/models";
import { availableProviders } from "@/lib/ai/provider";

export const maxDuration = 30;

/**
 * The single source every client (web, Android, macOS) renders its model
 * picker from: which models this user has unlocked, their reasoning efforts,
 * and the user's current defaults.
 */
export async function GET(): Promise<Response> {
	try {
		const userId = await getAuthUserId();
		const [providers, user] = await Promise.all([
			availableProviders(userId),
			prisma.user.findUnique({
				where: { id: userId },
				select: { defaultModelId: true, defaultEffort: true },
			}),
		]);

		const models = MODELS.map((model) => ({
			id: model.id,
			label: model.label,
			provider: model.provider,
			supportsAttachments: model.supportsAttachments,
			efforts: model.efforts,
			available: providers[model.provider].available,
		}));

		const storedDefault = user?.defaultModelId ? getModel(user.defaultModelId) : undefined;
		const defaultModelId =
			storedDefault && providers[storedDefault.provider].available ? storedDefault.id : DEFAULT_MODEL_ID;

		return NextResponse.json({
			models,
			defaults: {
				modelId: defaultModelId,
				effort: isReasoningEffort(user?.defaultEffort) ? user.defaultEffort : null,
			},
		});
	} catch (error) {
		if (error instanceof Response) return error;
		console.error("[api/ai/models] GET failed", error);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
