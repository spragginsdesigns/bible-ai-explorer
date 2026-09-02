import {
	PROVIDER_LABELS,
	type AiHouseMode,
	type AiModel,
	type AiModelsResponse,
	type AiProviderSummary,
} from "@/features/settings/aiApi";

/**
 * Pure selection rules behind the model picker sheet. They live outside the
 * component so the branches that actually bite - house mode, a stored pick for
 * a provider whose key is gone, a server that predates the `providers` array -
 * are unit tested without a React Native renderer.
 */

/** The house block, but only when the server put the account in house mode. */
export function houseMode(data: AiModelsResponse | null): AiHouseMode | null {
	if (!data || data.access !== "house") return null;
	return data.house ?? null;
}

/**
 * The model to render as picked: the stored pick while the server still offers
 * it, otherwise the server default. House mode always answers the house model,
 * because the server runs that regardless of what the client asks for.
 */
export function selectModelId(
	stored: string | null,
	data: AiModelsResponse | null,
): string | null {
	if (!data) return null;
	const house = houseMode(data);
	if (house) return house.modelId;
	const stillOffered = data.models.some((model) => model.id === stored && model.available);
	return stillOffered ? stored : data.defaults.modelId;
}

/**
 * Provider rows worth drawing: unlocked, and holding at least one model. Locked
 * providers are never shown - a row that only says "add a key" is noise, and
 * house mode has no provider rows at all.
 */
export function visibleProviders(data: AiModelsResponse | null): AiProviderSummary[] {
	if (!data || houseMode(data)) return [];
	if (data.providers?.length) {
		return data.providers.filter(
			(provider) => provider.available && modelsForProvider(data, provider.id).length > 0,
		);
	}
	// Pre-house-mode servers omit `providers`; derive the rows from the flat list.
	const derived = new Map<string, AiProviderSummary>();
	for (const model of data.models) {
		if (!model.available || derived.has(model.provider)) continue;
		derived.set(model.provider, {
			id: model.provider,
			label: PROVIDER_LABELS[model.provider] ?? model.provider,
			available: true,
		});
	}
	return [...derived.values()];
}

/** The models under one provider row, unavailable ones filtered out. */
export function modelsForProvider(data: AiModelsResponse | null, providerId: string): AiModel[] {
	if (!data) return [];
	return data.models.filter((model) => model.provider === providerId && model.available);
}
