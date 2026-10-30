import type { ModelDefinition } from "@/lib/ai/models";
import type { TranslationId } from "@/lib/bible/translations";
import type { Prisma, PrismaClient } from "@prisma/client";
import type {UIMessage,FilePart,ImagePart} from "ai";

export type HistorySurface = "chat" | "note";
export type HistoryReviewState = "pending" | "verified" | "withheld" | "notice";
export interface HistoryLocator { surface: HistorySurface; parentId: string; messageId: string }
export interface HistoryBinding { sourceDigest: string; contextDigest: string; policyDigest: string; displayDigest: string; reviewDigest: string; envelopeDigest: string }
export interface StoredHistoryRow { id: string; role: string; content: string; metadata: Record<string, unknown> | null; createdAt: string; [column: string]: unknown }
export interface HistorySource { surface: HistorySurface; parentId: string; ownerId: string; row: StoredHistoryRow }
export interface HistoryContext { translation: TranslationId; translationEvidence: "persisted" | "explicit-owner-review"; question: string; history: Record<string, unknown>[]; evidence: Record<string, unknown>[] }
export interface HistoryCorePolicy { contractVersion: 1; projectorVersion: string; rendererDigest: string; checkerVersion: string; corpusDigest: string; foundationDigest: string; fixedNoticesVersion: 1 }
export interface HistoryPolicy { core: HistoryCorePolicy; supportedTranslations: readonly TranslationId[]; reviewerModelId: string; reviewer: Pick<ModelDefinition, "provider" | "providerModelId" | "pricing">; implementationDigest: string; contextVersion: 1; meter: "background-utility"; entitlement: { plan: "free" | "pro"; comped: boolean; activeSubscription: boolean; subscriptionProvider: string | null; subscriptionPeriodEnd: string | null }; [key: string]: unknown }
export interface HistoryRenderer { digest: string; strip(value: string): string; normalize(value: string): string; receipts(parts: readonly unknown[]): unknown[]; progress(parts: readonly { type: string; data?: unknown }[]): unknown }
export interface HistoryDisplayRow { id: string; role: "assistant" | "user"; content: string; metadata: { parts: Record<string, unknown>[]; [key: string]: unknown }; createdAt?: string; feedback?: "up" | "down" | null }
/** Assistant rows from state GET are always safe projections or fixed notices. */
export interface HistoryStateResponse { state: "verified" | "notice" | "pending" | "withheld"; sourceDigest: string; row: HistoryDisplayRow }
/** POST never carries answer text; reload state after completion. */
export interface HistoryRecheckResponse { code: string; state?: "verified" | "notice" | "pending" | "withheld"; sourceDigest?: string }
export interface HistoryVersionPage { versions: { reviewId: string; createdAt: string; state: HistoryReviewState; sourceDigest: string }[]; next: string | null }
/** Capture by structuredClone inside actual server onToolExecutionEnd, never HTTP metadata. */
export interface ExecutedHistoryAction {tool: string; toolCallId: string; success: true; output: unknown}
export interface FreshReviewerIdentity {id:string;provider:ModelDefinition["provider"];providerModelId:string;pricing:NonNullable<ModelDefinition["pricing"]>;supportsAttachments:boolean}
export interface PreparedAttachment {id:string;userId:string;messageId:string|null;pathname:string;filename:string;mediaType:string;size:number;etag:string|null;status:string;transcript:string|null;durationSeconds:number|null;previewUrl?:string}
export interface PreparedRequestDescriptor {version:1;scope:"complete-server-prepared-request";rows:{id:string;role:string;sourceDigest:string}[];attachments:{id:string;messageId:string;identityDigest:string}[];preparedDigest:string;systemDigest:string;sourceSystemDigest?:string;reviewer:FreshReviewerIdentity}
export interface FreshRequestInput {messages:readonly Pick<UIMessage,"id"|"role"|"parts">[];sources:readonly {id:string;role:string;content:string;metadata?:unknown;createdAt?:string|Date}[];attachments:readonly PreparedAttachment[];systemContext:string;sourceSystemContext?:string;reviewer:FreshReviewerIdentity;mediaParts:readonly(FilePart|ImagePart)[];review(input:HistoryVerificationInput):Promise<HistoryVerificationResult>}
export interface FreshHistoryDraft {content: string; metadata: Record<string,unknown>; actions: ExecutedHistoryAction[]; preparedRequest?:object;operation?:{id:string;userId:string;noteId:string}; recovery?:{content:string;metadata:Record<string,unknown>}}
export interface FreshHistoryPreparation {ticket: object; blocks: {id:string;text:string}[]; question:string; context:string; sourceDigest:string; noticeOnly:boolean}
export interface FreshHistoryProof {readonly __opaqueFreshHistoryProof?: never}
export interface HistoryReviewManifest { blocks: {path: string; kind: string; text: string}[]; canonicalSources: {path: string; reference: string; text: string; translation: TranslationId; sourceKind: string}[]; actions: Record<string, unknown>[]; requiresActionProof: boolean; requiresSemanticReview: boolean; [key: string]: unknown }
export type HistoryProjectionResult = {ok: false; code: string; path: string} | {ok: true; kind: "assistant-review-candidate" | "user-authored" | "fixed-notice-only"; binding: HistoryBinding; display: HistoryDisplayRow; review: HistoryReviewManifest};
export interface CachedSubscription { status: string; periodEnd: Date; provider: string }
export interface LockedPolicySnapshot { user: {id: string; plan: string | null; aiConsentVersion: number | null; aiConsentAt: Date | null}; subscription: CachedSubscription | null }
export interface DurableHistoryProof { complete: boolean; manifest: Record<string, unknown>[] }
export interface HistoryReviewRecord extends HistoryBinding { id: string; ownerId: string; mainMessageId: string | null; noteAiMessageId: string | null; state: HistoryReviewState; sourceSnapshot: HistorySource; sanitizedDisplay: HistoryDisplayRow; requiresActionProof: boolean; canonicalPassed: boolean; semanticPassed: boolean; actionProofPassed: boolean; reviewerModelId: string | null; issueCodes: string[]; leaseToken: string | null; expiresAt: Date | null; retryAfter: Date | null; attemptCount: number; createdAt: Date; updatedAt: Date; checkedAt: Date | null }
export interface HistoryTransaction {
 currentTime(): Promise<Date>;
 hasConsent(): Promise<boolean>;
 readPolicySnapshot(): Promise<LockedPolicySnapshot>;
 loadOwnedTarget(locator: HistoryLocator): Promise<StoredHistoryRow | null>;
 loadPreparedDependencies(locator:HistoryLocator,ids:string[],attachmentIds:string[]):Promise<{rows:StoredHistoryRow[];attachments:PreparedAttachment[]}>;
 loadPreparedReview(locator:HistoryLocator):Promise<{descriptor:PreparedRequestDescriptor;external?:unknown}|null>;
 loadOwnedBundle(locator: HistoryLocator, maxRows: number): Promise<{target: StoredHistoryRow; prefix: StoredHistoryRow[]; complete: boolean; attachmentsPresent: boolean} | null>;
 loadFreshBundle(locator: HistoryLocator, draft: FreshHistoryDraft & {createdAt?:string;sourceWindow?:string[]}, maxRows: number): Promise<{target:StoredHistoryRow;previous:StoredHistoryRow|null;prefix:StoredHistoryRow[];complete:boolean;attachmentsPresent:boolean}|null>;
 saveFreshTarget(locator:HistoryLocator,target:StoredHistoryRow):Promise<StoredHistoryRow>;
 loadDurableActionProof(locator: HistoryLocator, actions: Record<string, unknown>[]): Promise<DurableHistoryProof>;
 findBinding(binding: HistoryBinding): Promise<HistoryReviewRecord | null>;
 activeLease(now: Date): Promise<HistoryReviewRecord | null>;
 expireLeases(now: Date): Promise<unknown>;
 createReview(data: Omit<HistoryReviewRecord, "id">): Promise<HistoryReviewRecord>;
 certifyFreshReview(id:string,data:Partial<HistoryReviewRecord>):Promise<boolean>;
 retryLease(id: string, options: {leaseToken: string; expiresAt: Date; now: Date}): Promise<HistoryReviewRecord | null>;
 findLease(id: string, token: string, now: Date): Promise<HistoryReviewRecord | null>;
 finishLease(id: string, token: string, now: Date, data: Partial<HistoryReviewRecord>): Promise<boolean>;
 targetVersions(locator: HistoryLocator, reviewId: string | null, take: number, after?: string | null): Promise<HistoryReviewRecord[]>;
}
export interface HistoryRepository { withOwnerLock<T>(ownerId: string, work: (tx: HistoryTransaction) => Promise<T>): Promise<T> }
export interface HistoryVerificationInput { ownerId: string; policy: HistoryPolicy; translation: TranslationId; question: string; context: string; canonicalContext?:string; blocks: {id: string; text: string}[]; manifest: HistoryReviewManifest; signal: AbortSignal; allowRepair: false;mediaParts?:readonly(FilePart|ImagePart)[];authorizeInference(): Promise<void> }
export interface HistoryVerificationResult {verified: boolean; canonicalPassed: boolean; semanticPassed: boolean; repaired: boolean; blocks: {id: string; text: string}[]; reviewerModelId: string}
export interface HistoryResult { status: number; body: unknown; headers?: Record<string,string> }
export interface HistoryService {prepareRequest(owner:string,locator:HistoryLocator,input:FreshRequestInput):Promise<object>;prepareFresh(owner:string,locator:HistoryLocator,draft:FreshHistoryDraft):Promise<FreshHistoryPreparation>; reviewFresh(preparation:FreshHistoryPreparation,options?:{signal?:AbortSignal}):Promise<HistoryVerificationResult>; certifyFresh(owner:string,locator:HistoryLocator,proof:FreshHistoryProof):Promise<HistoryStateResponse>; get(owner: string, locator: HistoryLocator): Promise<HistoryResult>; recheck(owner: string, locator: HistoryLocator, expectedSourceDigest: string, options?: {signal?: AbortSignal}): Promise<HistoryResult>; versions(owner: string, locator: HistoryLocator, after?: string | null): Promise<HistoryResult>; download(owner: string, locator: HistoryLocator, reviewId?: string | null): Promise<HistoryResult> }
export interface HistoryRepositoryDependencies { hasCurrentAiConsent(user: LockedPolicySnapshot["user"]): boolean; readSubscription(owner: string, db: Prisma.TransactionClient): Promise<CachedSubscription | null>; loadDurableActionProof?(input: {db: Prisma.TransactionClient; ownerId: string; locator: HistoryLocator; actions: Record<string, unknown>[]}): Promise<DurableHistoryProof> }
export type HistoryPrismaClient = Pick<PrismaClient, "$transaction">;
