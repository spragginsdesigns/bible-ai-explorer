import "server-only";
import { activeSubscription } from "@/lib/billing/plans";
import { resolvePlan } from "@/lib/entitlements-rules";
import { houseChatModelId, resolveDefinition } from "@/lib/ai/models";
import { CORE_VERSION } from "./projection.mjs";
import { HistoryError } from "./service.mjs";
import { HISTORY_CHECKER_DIGEST, HISTORY_CORPUS_DIGEST, HISTORY_CORPUS_IDENTITIES, HISTORY_FOUNDATION_DIGEST, HISTORY_IMPLEMENTATION_DIGEST, HISTORY_RENDERER_DIGEST, HISTORY_SUPPORTED_TRANSLATIONS, HISTORY_EXTERNAL_SOURCE_IDENTITIES } from "./manifest";
import type { HistoryPolicy, HistoryTransaction } from "./contracts";

export interface HistoryPolicyConfiguration {usageEnabled: boolean; openrouterAvailable: boolean; proUserIds: readonly string[]; serverCredentialUserIds: readonly string[]}

/** DB-only callback contract: never call getUserPlan/Play refresh, model factories or usage reservation here. */
export function createHistoryPolicyLoader(configuration: HistoryPolicyConfiguration) {
 return async (tx: HistoryTransaction, ownerId: string): Promise<HistoryPolicy> => {
  const {user, subscription} = await tx.readPolicySnapshot();
  if (user.id !== ownerId) throw new HistoryError("not_found", 404);
  const current = await tx.currentTime();
  const comped = configuration.proUserIds.includes(ownerId) || configuration.serverCredentialUserIds.includes(ownerId);
  const subscribed = configuration.usageEnabled && subscription !== null && activeSubscription(subscription, current);
  const plan = comped || subscribed ? "pro" : resolvePlan({plan: user.plan, userId: ownerId, allowlist: []});
  const modelId = houseChatModelId(plan, {openrouter: configuration.openrouterAvailable});
  const definition = resolveDefinition(modelId);
  if (!definition?.pricing || !Number.isFinite(definition.pricing.input) || !Number.isFinite(definition.pricing.output) || definition.pricing.input < 0 || definition.pricing.output < 0) throw new HistoryError("verification_unavailable", 503);
  return {
   core: {contractVersion: 1, projectorVersion: CORE_VERSION, rendererDigest: HISTORY_RENDERER_DIGEST, checkerVersion: HISTORY_CHECKER_DIGEST, corpusDigest: HISTORY_CORPUS_DIGEST, foundationDigest: HISTORY_FOUNDATION_DIGEST, fixedNoticesVersion: 1},
   supportedTranslations: HISTORY_SUPPORTED_TRANSLATIONS,
   corpusIdentity: HISTORY_CORPUS_IDENTITIES,
   externalSourceIdentities: HISTORY_EXTERNAL_SOURCE_IDENTITIES,
   implementationDigest: HISTORY_IMPLEMENTATION_DIGEST,
   contextVersion: 1,
   reviewerModelId: definition.id,
   reviewer: {provider: definition.provider, providerModelId: definition.providerModelId, pricing: definition.pricing},
   entitlement: {plan, comped, activeSubscription: subscribed, subscriptionProvider: subscription?.provider ?? null, subscriptionPeriodEnd: subscription?.periodEnd.toISOString() ?? null},
   meter: "background-utility",
  };
 };
}
