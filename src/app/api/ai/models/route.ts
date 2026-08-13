import { NextResponse } from "next/server";
import { getAuthUserId } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
	DEFAULT_MODEL_ID,
	isReasoningEffort,
	PROVIDERS,
	resolveDefinition,
	type ModelDefinition,
} from "@/lib/ai/models";
import { curatedModelsFor, listProviderModels } from "@/lib/ai/modelCatalog";
import { apiKeyOrNull, availableProviders } from "@/lib/ai/provider";

export const maxDuration = 30;

/**
 * The single source every client (web, Android, macOS) renders its model
 * picker from. For each provider the user has unlocked, the model list comes
 * live from that provider's own /models endpoint — whatever the key can
 * reach — with the curated registry as label source and outage fallback.
 * Locked providers show their curated models so the picker can advertise
 * what adding a key unlocks.
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

		const catalogs = await Promise.all(
			PROVIDERS.map(async (provider) => {
				let models: ModelDefinition[];
				if (providers[provider.id].available) {
					const apiKey = await apiKeyOrNull(userId, provider.id);
					models = apiKey
						? await listProviderModels(provider.id, apiKey)
						: curatedModelsFor(provider.id);
				} else {
					models = curatedModelsFor(provider.id);
				}
				return { provider, models };
			}),
		);

		const models = catalogs.flatMap(({ provider, models: definitions }) =>
			definitions.map((model) => ({
				id: model.id,
				label: model.label,
				provider: model.provider,
				supportsAttachments: model.supportsAttachments,
				efforts: model.efforts,
				available: providers[provider.id].available,
			})),
		);

		const storedDefault = user?.defaultModelId ? resolveDefinition(user.defaultModelId) : undefined;
		const defaultModelId =
			storedDefault && providers[storedDefault.provider].available ? storedDefault.id : DEFAULT_MODEL_ID;

		return NextResponse.json({
			providers: PROVIDERS.map((provider) => ({
				id: provider.id,
				label: provider.label,
				available: providers[provider.id].available,
			})),
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
