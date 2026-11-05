import "server-only";
import { prisma } from "@/lib/prisma";
import { getAuthUser, getAuthUserId } from "@/lib/auth";
import { accountSubscription } from "@/lib/billing/subscription";
import { IncludedAiLimitError } from "@/lib/billing/usage-errors";
import { hasCurrentAiConsent } from "@/lib/preferences-contract";
import { parseUserIdAllowlist } from "@/lib/entitlements-rules";
import { houseChatModel, resolveVerificationModel } from "@/lib/ai/provider";
import { buildProviderOptions, NO_RUN_OPTIONS,resolveDefinition,resolveReviewerDefinition,type ModelDefinition } from "@/lib/ai/models";
import type {LanguageModel,JSONValue} from "ai";
import { getChapter } from "@/lib/bible/translations";
import { verifyScriptureDraft } from "@/lib/ai/scripture-verification";
import { verifyGeneratedAnswer } from "@/lib/ai/verified-generation";
import { createPrismaHistoryRepository } from "./repository.mjs";
import { createHistoryService } from "./service.mjs";
import { createVerifyOnlyAdapter } from "./verify-only.mjs";
import { createHistoryPolicyLoader } from "./policy";
import { historyRenderer } from "./renderer";
import { loadHistoryReadSnapshot } from "./read-snapshot.mjs";
import type { HistorySurface } from "./contracts";
import { readHistoryBatch } from "./read-batch.mjs";
import { createHistoryHandlers } from "./handlers";
import {reviewerIdentity} from "./prepared-request.mjs";
import {canonicalJSON} from "./projection.mjs";

const repository = createPrismaHistoryRepository(prisma, {
 hasCurrentAiConsent,
 // Explicit tx argument prevents the billing helper's global-client fallback. This helper performs DB reads only.
 readSubscription: (ownerId, db) => accountSubscription(ownerId,db),
 // No legacy receipt is considered durable operation proof. No tool or note append is replayed.
 loadDurableActionProof: async () => ({complete: false, manifest: []}),
});
const loadCurrentPolicy = createHistoryPolicyLoader({
 usageEnabled: process.env.SUREWORD_USAGE_ENABLED === "true",
 openrouterAvailable: Boolean(process.env.OPENROUTER_API_KEY?.trim()),
 proUserIds: parseUserIdAllowlist(process.env.PRO_USER_IDS),
 serverCredentialUserIds: parseUserIdAllowlist(process.env.SERVER_CREDENTIAL_USER_IDS),
});
const verifyOnly = createVerifyOnlyAdapter({
 houseChatModel, resolveVerificationModel, verifyScriptureDraft, verifyGeneratedAnswer,
 providerOptionsForReview: definition => buildProviderOptions(definition.provider,{...NO_RUN_OPTIONS,effort: "high"},false,definition),
 isQuotaError: error => error instanceof IncludedAiLimitError,
});
export const historyService = createHistoryService({repository, loadCurrentPolicy, renderer: historyRenderer, verifyOnly, verifyCanonical: verifyScriptureDraft, loadCanonicalChapter:getChapter,
 validateFreshReviewer:identity=>{try{const current=resolveDefinition(identity.id);return Boolean(current&&canonicalJSON(reviewerIdentity(current))===canonicalJSON(identity));}catch{return false;}},
});
/** Reuse the actual server-resolved current model, utility meter and bounded allowance. */
export function createCurrentRequestReview(answerDefinition:ModelDefinition,model:LanguageModel,providerOptions?:Record<string,Record<string,JSONValue>>){
 // The reviewer is the model that actually runs, never the owner's unpriced
 // SureWord AI display row (see resolveReviewerDefinition).
 const definition=resolveReviewerDefinition(answerDefinition.id)??answerDefinition;
 return{reviewer:reviewerIdentity(definition),review:createVerifyOnlyAdapter({
  allowEvidenceCompletion:true,
  houseChatModel:async()=>({definition}),resolveVerificationModel:async()=>model,
  providerOptionsForReview:()=>providerOptions??{},verifyScriptureDraft,verifyGeneratedAnswer,
  isQuotaError:error=>error instanceof IncludedAiLimitError,
 })};
}
// Auth runs before, not inside, retried DB callbacks; preserve the real thrown 401 Response.
export const historyHandlers = createHistoryHandlers(historyService,{read: getAuthUserId,write: getAuthUser});

/** One request-local ordinary-read snapshot; no inference, writes or external work in its transaction. */
export async function readHistoryList(ownerId: string, surface: HistorySurface, parentId: string) {
 return readHistoryBatch({ ownerId, surface, parentId,
  loadSnapshot: () => loadHistoryReadSnapshot(prisma, ownerId, {surface, parentId}, {
   hasCurrentAiConsent, readSubscription: (owner, db) => accountSubscription(owner, db),
  }),
  createService: (snapshot, canonical) => createHistoryService({repository: snapshot.repository, loadCurrentPolicy, renderer: historyRenderer,
   ...canonical,
   verifyOnly: async () => { throw new Error("Ordinary history reads cannot request inference."); },
   validateFreshReviewer: identity => {try {const current=resolveDefinition(identity.id);return Boolean(current&&canonicalJSON(reviewerIdentity(current))===canonicalJSON(identity));}catch{return false;}},
  }),
  verifyCanonical: verifyScriptureDraft, loadCanonicalChapter: getChapter,
 });
}
