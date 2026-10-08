import { NextResponse } from "next/server";
import { getAuthUserId } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
	DEFAULT_MODEL_ID,
	isReasoningEffort,
	isReasoningMode,
	isSpeed,
	isVerbosity,
	PROVIDERS,
	resolveDefinition,
	toModelPayload,
	type ModelDefinition,
} from "@/lib/ai/models";
import { curatedModelsFor, listProviderModels } from "@/lib/ai/modelCatalog";
import { aiAccessFor, apiKeyOrNull, availableProviders, houseChatModel } from "@/lib/ai/provider";
import { houseEffortFor, houseEffortsFor } from "@/lib/ai/access";

export const maxDuration = 30;

/** What a Free account's included AI is called in every picker. */
const HOUSE_FREE_LABEL = "SureWord AI";

const HOUSE_NOTE =
	process.env.SUREWORD_USAGE_ENABLED === "true"
		? "Included with SureWord. Use Membership in Settings to switch to a personal API key and choose other models."
		: "Included with SureWord. Add your own API key in Settings to choose other models.";

/**
 * The single source every client (web, Android, macOS) renders its model
 * picker from.
 *
 * An account with no key of its own is in `house` mode: it runs on SureWord's
 * key, on one model, and the response says so with a single-entry list and no
 * providers, so a picker has nothing to render but the house note.
 *
 * An account with keys gets only what it can actually reach. For each unlocked
 * provider the model list comes live from that provider's own /models endpoint
 * (whatever the key can reach), with the curated registry as label source and
 * outage fallback. Locked providers are omitted entirely rather than shown as
 * unavailable, so no client can present a model it cannot run.
 */
export async function GET(): Promise<Response> {
	try {
		const userId = await getAuthUserId();
		const [access, user] = await Promise.all([
			aiAccessFor(userId),
			prisma.user.findUnique({
				where: { id: userId },
				select: {
					defaultModelId: true,
					defaultEffort: true,
					defaultSpeed: true,
					defaultVerbosity: true,
					defaultMode: true,
				},
			}),
		]);

		if (access === "house") {
			const { definition: house, plan } = await houseChatModel(userId);
			// Pro chooses how hard Luna thinks; Free has no choice. Only efforts the
			// head actually takes are offered, and the stored pick is clamped the
			// same way the chat route clamps it.
			const efforts = houseEffortsFor(plan).filter((effort) => house.efforts.includes(effort));
			const preferred = houseEffortFor(plan === "pro" ? user?.defaultEffort : null, plan);
			const houseEffort = house.efforts.includes(preferred) ? preferred : null;
			// Free never sees a model name: it is SureWord's included AI, and naming
			// the head only invites comparisons with the Pro picker.
			const label = plan === "pro" ? house.label : HOUSE_FREE_LABEL;
			// The house entry carries the same capability fields as any other. A
			// client renders the Reasoning chips from `house.efforts` (empty for
			// Free, and absent on servers before 2026-10-08) and no other options.
			return NextResponse.json({
				access,
				providers: [],
				models: [{ ...toModelPayload(house), label }],
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
					effort: houseEffort,
					efforts,
					note: HOUSE_NOTE,
				},
			});
		}

		const providers = await availableProviders(userId);
		const unlocked = PROVIDERS.filter((provider) => providers[provider.id].available);

		const catalogs = await Promise.all(
			unlocked.map(async (provider) => {
				const apiKey = await apiKeyOrNull(userId, provider.id);
				const models: ModelDefinition[] = apiKey
					? await listProviderModels(provider.id, apiKey)
					: curatedModelsFor(provider.id);
				return { provider, models };
			}),
		);

		const models = catalogs.flatMap(({ models: definitions }) =>
			definitions.map((model) => toModelPayload(model)),
		);

		const storedDefault = user?.defaultModelId ? resolveDefinition(user.defaultModelId) : undefined;
		// Never name a model the picker did not list: a selected-but-locked id is
		// what made a picker show a model the user could not actually run. The
		// registry default is the last resort for the degenerate case of an
		// allowlisted account whose server keys are all unset.
		const storedIsListed =
			storedDefault !== undefined && models.some((model) => model.id === storedDefault.id);
		const defaultModelId = storedIsListed
			? storedDefault.id
			: (models[0]?.id ?? DEFAULT_MODEL_ID);

		return NextResponse.json({
			access,
			providers: unlocked.map((provider) => ({
				id: provider.id,
				label: provider.label,
				available: true,
			})),
			models,
			// A stored value the selected model does not offer is still returned:
			// the client renders it as the default chip without erasing it, so
			// switching back to a model that does offer it restores the choice.
			defaults: {
				modelId: defaultModelId,
				effort: isReasoningEffort(user?.defaultEffort) ? user.defaultEffort : null,
				speed: isSpeed(user?.defaultSpeed) ? user.defaultSpeed : null,
				verbosity: isVerbosity(user?.defaultVerbosity) ? user.defaultVerbosity : null,
				mode: isReasoningMode(user?.defaultMode) ? user.defaultMode : null,
			},
			house: null,
		});
	} catch (error) {
		if (error instanceof Response) return error;
		console.error("[api/ai/models] GET failed", error);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
