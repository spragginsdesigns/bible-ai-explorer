/** Saved-history review service; authority comes from owned server-injected dependencies. */
import { randomUUID } from 'node:crypto';
import { isHistorySerializationConflict } from './transaction-conflicts.mjs';
import { projectHistory, digest, canonicalJSON, matchesStoredReview, FIXED_NOTICES, historyAISourceRow } from './projection.mjs';
import { freshActionManifest, isFixedNoteReceiptFallback, createFreshPreparation, readFreshPreparation, readFreshHistoryProof } from './fresh-proof.mjs';
import {createPreparedRequest,readPreparedRequest,preparedDependenciesMatch} from './prepared-request.mjs';
export const LIMITS = Object.freeze({ prefixRows: 80, contextChars: 64000, questionChars: 16000, leaseMs: 90000, verifyMs: 60000, retryMs: 60000, exportBytes: 2000000 });
const SAFE_CODES = new Set(['not_found', 'not_assistant', 'source_changed', 'context_changed', 'policy_changed', 'consent_required', 'pending', 'account_busy', 'lease_expired', 'retry_later', 'source_limit', 'context_limit', 'context_incomplete', 'context_ambiguous', 'missing_question', 'unknown_translation', 'unsupported_attachment_context', 'projection_refused', 'notice_has_unreviewed_extras', 'action_proof_missing', 'canonical_rejected', 'semantic_rejected', 'review_changed_text', 'reviewer_changed', 'verification_unavailable', 'verification_timeout', 'quota_exhausted', 'stale_lease', 'original_limit', 'review_required', 'unversioned_corpus']);
export class HistoryError extends Error {
    constructor(code, status = 422, retryAfter = null) { super(code); this.code = SAFE_CODES.has(code) ? code : 'verification_unavailable'; this.status = status; this.retryAfter = retryAfter; }
}
const clone = value => JSON.parse(canonicalJSON(value));
const keys = ['sourceDigest', 'contextDigest', 'policyDigest', 'displayDigest', 'reviewDigest', 'envelopeDigest'];
const bindingEqual = (a, b) => keys.every(key => a?.[key] === b?.[key]);
export const locatorValid = value => value && ['chat', 'note'].includes(value.surface) && ['parentId', 'messageId'].every(key => typeof value[key] === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(value[key]));
const response = (status, code, extra = {}) => ({ status, body: { code, ...extra } });
export function fixedHistoryRow(row, state, code, sourceDigest = null) {
    const text = state === 'pending' ? 'This saved answer is being checked before it can be shown.' : 'This saved answer is withheld until its source and claims can be verified. The original is available to download.';
    return { id: row.id, role: 'assistant', content: text, metadata: { parts: [{ type: 'text', text }], historyVerification: { state, code, ...(sourceDigest ? { sourceDigest } : {}) } }, ...(row.createdAt ? { createdAt: row.createdAt } : {}) };
}
const isExactNotice = candidate => candidate.kind === 'fixed-notice-only' && Object.values(FIXED_NOTICES).includes(candidate.display.content) && candidate.display.metadata.parts.length === 1 && candidate.display.metadata.parts[0].type === 'text' && Object.keys(candidate.display.metadata).every(key => ['parts', 'translation'].includes(key)) && candidate.review.blocks.length === 1;
const coreRow = historyAISourceRow;
const checkedBinding = (sourceSnapshot, context, policy, display, review) => {
    const binding = { sourceDigest: digest(sourceSnapshot), contextDigest: digest(context), policyDigest: digest(policy), displayDigest: digest(display), reviewDigest: digest(review) };
    return { ...binding, envelopeDigest: digest(binding) };
};
// The verifier already receives every block's exact text. Retain the complete
// envelope structure/numbers while pointing repeated strings to those blocks,
// rather than tripling a long answer in the complete-context budget.
function reviewEnvelope(context, candidate) {
    const byText=new Map(candidate.review.blocks.map(block=>[block.text,block.path]));
    const pointers=value=>typeof value==='string'&&byText.has(value)?{checkedBlock:byText.get(value)}:Array.isArray(value)?value.map(pointers):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([key,item])=>[key,pointers(item)])):value;
    const {blocks,...manifest}=candidate.review;
    return canonicalJSON({savedHistoryContext:context,display:pointers(candidate.display),manifest:{...pointers(manifest),blocks:blocks.map(({path,kind})=>({path,kind}))},blockPointers:'checkedBlock names an exact block ID/text supplied separately to this same review; no display field or source has been clipped.'});
}
function blockedSnapshot(sourceSnapshot, context, policy, code) {
    const display = fixedHistoryRow(sourceSnapshot.row, 'withheld', code), review = { blocked: true, code };
    return { sourceSnapshot, context, policy, code, candidate: null, display, review, binding: checkedBinding(sourceSnapshot, context, policy, display, review), requiresActionProof: false };
}
/** The complete saved prefix is transient. Only exact target sourceSnapshot is ever persisted. */
async function build(tx, ownerId, locator, policy, renderer, freshBundle = null, executions = null, prepared = null) {
    const bundle = freshBundle ?? (prepared ? {target:await tx.loadOwnedTarget(locator),prefix:[],complete:true,attachmentsPresent:false}:await tx.loadOwnedBundle(locator, LIMITS.prefixRows));
    if (!bundle?.target)
        throw new HistoryError('not_found', 404);
    const sourceSnapshot = { surface: locator.surface, parentId: locator.parentId, ownerId, row: historyAISourceRow(bundle.target) };
    try {
        digest(sourceSnapshot);
    }
    catch {
        throw new HistoryError('source_limit', 413);
    }
    if (bundle.target.role !== 'assistant')
        throw new HistoryError('not_assistant', 400);
    let context = { translation: bundle.target.metadata?.translation ?? null, translationEvidence: 'persisted', question: '', history: [], evidence: [] };
    const block = code => blockedSnapshot(sourceSnapshot, context, policy, code);
    // Fixed operational output makes no claim about an earlier question or
    // attachment. Classify its entire display before generated-answer context
    // bounds; an overlong/unsupported prefix must not prevent a truthful saved
    // withholding notice (or a constant receipt proved by an actual execution).
    if (Object.values(FIXED_NOTICES).includes(sourceSnapshot.row.content) && ['KJV','NKJV','BSB','ASV','RV1909','LUT1912'].includes(context.translation)) {
        try {
            const operationalContext={...context,evidence:[{kind:'fixed-operational-envelope',version:1}]};
            let candidate=projectHistory({source:sourceSnapshot,context:operationalContext,policy:policy.core},renderer);
            let safe=candidate.ok&&isExactNotice(candidate);
            if(candidate.ok&&!safe){
                const proof=executions!==null?{complete:true,manifest:freshActionManifest(sourceSnapshot,executions)}:await tx.loadDurableActionProof(locator,candidate.review.actions);
                if(proof?.complete&&isFixedNoteReceiptFallback(sourceSnapshot,proof.manifest)){
                    operationalContext.evidence.push({kind:'owned-durable-action-proof',manifest:proof.manifest});
                    candidate=projectHistory({source:sourceSnapshot,context:operationalContext,policy:policy.core},renderer);
                    safe=candidate.ok;
                }
            }
            if(safe){
                const binding=checkedBinding(sourceSnapshot,operationalContext,policy,candidate.display,candidate.review);
                candidate={...candidate,binding};
                return{sourceSnapshot,context:operationalContext,policy,candidate,display:candidate.display,review:candidate.review,binding,requiresActionProof:candidate.review.requiresActionProof,reviewContext:reviewEnvelope(operationalContext,candidate),fixedOperational:true};
            }
        } catch { /* Any unknown field or missing execution proof uses the strict path below. */ }
    }
    if(prepared){
        const dependencies=await tx.loadPreparedDependencies(locator,prepared.descriptor.rows.map(row=>row.id),prepared.descriptor.attachments.map(row=>row.id));
        if(!preparedDependenciesMatch(prepared.descriptor,dependencies))return block('context_changed');
        context.evidence=[{kind:'complete-server-prepared-request',descriptor:prepared.descriptor}];
    }
    else {
        if (!bundle.complete || bundle.prefix.length > LIMITS.prefixRows)
            return block('context_incomplete');
        if (bundle.attachmentsPresent)
            return block('unsupported_attachment_context');
        if (bundle.prefix.some((row, i) => !['user', 'assistant'].includes(row.role) || i > 0 && row.createdAt === bundle.prefix[i - 1].createdAt))
            return block('context_ambiguous');
        context.history = bundle.prefix.filter(row => row.id !== bundle.target.id).map(historyAISourceRow);
        const user = [...context.history].reverse().find(row => row.role === 'user');
        context.question = user?.content ?? '';
        context.evidence = [{ kind: 'complete-owned-saved-prefix', count: bundle.prefix.length, version: 1 }];
    }
    const user = prepared ? {content:prepared.question??''} : [...context.history].reverse().find(row=>row.role==='user');
    if (!['KJV', 'NKJV', 'BSB', 'ASV', 'RV1909', 'LUT1912'].includes(context.translation))
        return block('unknown_translation');
    const projectedSource = { ...sourceSnapshot, row: coreRow(bundle.target) };
    let candidate;
    try {
        candidate = projectHistory({ source: projectedSource, context, policy: policy.core }, renderer);
    }
    catch {
        return block('projection_refused');
    }
    if (!candidate.ok)
        return block('projection_refused');
    if (candidate.review.canonicalSources.some(source => !policy.supportedTranslations.includes(source.translation))) return block('unversioned_corpus');
    if (candidate.kind === 'fixed-notice-only') {
        if (!isExactNotice(candidate))
            return block('notice_has_unreviewed_extras');
    }
    else if (!user)
        return block('missing_question');
    let durableManifest=[];
    {
        let proof;
        try { proof = executions !== null ? {complete: true, manifest: freshActionManifest(sourceSnapshot, executions)} : await tx.loadDurableActionProof(locator, candidate.review.actions); }
        catch { return block('action_proof_missing'); }
        if (candidate.review.requiresActionProof && !proof?.complete)
            return block('action_proof_missing');
        if (proof?.complete && proof.manifest.length) {
            durableManifest=proof.manifest;
            context.evidence.push({ kind: 'owned-durable-action-proof', manifest: proof.manifest });
            candidate = projectHistory({ source: projectedSource, context, policy: policy.core }, renderer);
            if (!candidate.ok) return block('projection_refused');
        }
    }
    if (!policy.supportedTranslations.includes(context.translation)&&!isExactNotice(candidate)&&!isFixedNoteReceiptFallback(sourceSnapshot,durableManifest)) return block('unversioned_corpus');
    try {
        if (context.question.length > LIMITS.questionChars || canonicalJSON(context).length > LIMITS.contextChars)
            return block('context_limit');
        // Required history context uses the explicit complete 64k internal
        // verifier option; never silently trim it to the ordinary 16k default.
        const reviewContext = reviewEnvelope(prepared?.logical?{...context,preparedRequest:prepared.logical,preparedSystemContext:prepared.systemContext}:context,candidate);
        if (reviewContext.length > LIMITS.contextChars)
            return block('context_limit');
        const binding = checkedBinding(sourceSnapshot, context, policy, candidate.display, candidate.review);
        candidate = { ...candidate, binding };
        return { sourceSnapshot, context, policy, candidate, display: candidate.display, review: candidate.review, binding, requiresActionProof: candidate.review.requiresActionProof, reviewContext, externalChapters:prepared?.external?.evidence?.chapters??[] };
    }
    catch {
        return block('context_limit');
    }
}
function recordData(built, locator, ownerId, now) { return { ownerId, mainMessageId: locator.surface === 'chat' ? locator.messageId : null, noteAiMessageId: locator.surface === 'note' ? locator.messageId : null, ...built.binding, sourceSnapshot: clone(built.sourceSnapshot), sanitizedDisplay: clone(built.display), requiresActionProof: built.requiresActionProof, canonicalPassed: false, semanticPassed: false, actionProofPassed: false, reviewerModelId: null, issueCodes: built.code ? [built.code] : [], createdAt: now, updatedAt: now, checkedAt: null }; }
function recordMatches(record, built) {
    if (!record || !built.candidate || !bindingEqual(record, built.binding))
        return false;
    try {
        if (digest(record.sourceSnapshot) !== record.sourceDigest || digest(record.sanitizedDisplay) !== record.displayDigest)
            return false;
        return matchesStoredReview(built.candidate, { ...record, status: record.state });
    }
    catch {
        return false;
    }
}
async function boundedReview(task, timeoutMs, signal) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (signal?.aborted)
        abort();
    else
        signal?.addEventListener('abort', abort, { once: true });
    let timer;
    const deadline = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new HistoryError('verification_timeout', 503)); }, timeoutMs); controller.signal.addEventListener('abort', () => reject(new HistoryError('verification_timeout', 503)), { once: true }); });
    try {
        controller.signal.throwIfAborted();
        return await Promise.race([task(controller.signal), deadline]);
    }
    finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
    }
}
export function createHistoryService({ repository, loadCurrentPolicy, renderer, verifyOnly, verifyCanonical, loadCanonicalChapter, validateFreshReviewer=()=>false, now = () => new Date(), token = randomUUID, verifyMs = LIMITS.verifyMs, externalMs = 12_000 }) {
    const policy = async (tx, ownerId, external=null, reviewer=null) => {
        const current=clone(await loadCurrentPolicy(tx,ownerId));
        if(reviewer){if(!await validateFreshReviewer(reviewer))throw new HistoryError('policy_changed',409);Object.assign(current,{reviewerModelId:reviewer.id,reviewer:{provider:reviewer.provider,providerModelId:reviewer.providerModelId,pricing:reviewer.pricing},freshReviewer:reviewer});}
        return{...current,...(external?{externalEvidence:external.evidence}:{})};
    }; // DB-only; no key/model/usage reservation.
    const fixedBuilt=built=>isExactNotice(built.candidate??{})||isFixedNoteReceiptFallback(built.sourceSnapshot,built.context.evidence.find(item=>item.kind==='owned-durable-action-proof')?.manifest??[]);
    const captureExternal=async built=>{
        if(built.context.translation!=='NKJV'||!built.candidate||fixedBuilt(built))return null;
        if(typeof verifyCanonical!=='function'||typeof loadCanonicalChapter!=='function'||!built.policy.externalSourceIdentities?.NKJV)throw new HistoryError('verification_unavailable',503);
        return boundedReview(async signal=>{
            const chapters=new Map();
            for(const coordinate of built.externalChapters??[]){
                if(!Number.isInteger(coordinate.order)||coordinate.order<1||coordinate.order>66||!Number.isInteger(coordinate.chapter)||coordinate.chapter<1||coordinate.chapter>150)throw new HistoryError('canonical_rejected');
                chapters.set(`${coordinate.order}:${coordinate.chapter}`,{order:coordinate.order,chapter:coordinate.chapter});
            }
            if(chapters.size>24)throw new HistoryError('context_limit');
            const collect=checked=>{
                for(const reference of checked.references??[])for(const verse of reference.verses??[]){
                    if(!Number.isInteger(verse.order)||!Number.isInteger(verse.chapter))throw new HistoryError('canonical_rejected');
                    chapters.set(`${verse.order}:${verse.chapter}`,{order:verse.order,chapter:verse.chapter});
                }
                if(chapters.size>24)throw new HistoryError('context_limit');
            };
            for(const block of built.review.blocks){
                const checked=await verifyCanonical(block.text,{translation:'NKJV'});signal.throwIfAborted();
                if(!checked.ok||checked.text!==block.text)throw new HistoryError('canonical_rejected');collect(checked);
            }
            for(const source of built.review.canonicalSources.filter(source=>source.translation==='NKJV')){
                const checked=await verifyCanonical(`[[SCRIPTURE:${source.reference}]]`,{translation:'NKJV'});signal.throwIfAborted();
                if(!checked.ok||checked.references.length!==1||checked.references[0].canonicalText!==source.text)throw new HistoryError('canonical_rejected');collect(checked);
            }
            for(const text of [built.context.question,built.reviewContext]){const checked=await verifyCanonical(text,{translation:'NKJV'});signal.throwIfAborted();collect(checked);}
            const captured=await Promise.all([...chapters.values()].map(async coordinate=>{
                const words=await loadCanonicalChapter('NKJV',coordinate.order,coordinate.chapter);signal.throwIfAborted();
                if(!Array.isArray(words)||!words.length||words.some(text=>typeof text!=='string'||!text.trim()))throw new HistoryError('verification_unavailable',503);
                return {...coordinate,digest:digest(words)};
            }));
            captured.sort((a,b)=>a.order-b.order||a.chapter-b.chapter);
            return {sourceDigest:built.binding.sourceDigest,evidence:{translation:'NKJV',sourceIdentity:built.policy.externalSourceIdentities.NKJV,chapters:captured}};
        },Math.max(1,Math.min(externalMs,12_000)));
    };
    const bindExternal=(built,external)=>{
        if(!external)return built;
        if(built.binding.sourceDigest!==external.sourceDigest)throw new HistoryError('source_changed',409);
        const currentPolicy={...built.policy,externalEvidence:external.evidence};
        const binding=checkedBinding(built.sourceSnapshot,built.context,currentPolicy,built.display,built.review);
        return {...built,policy:currentPolicy,binding,candidate:built.candidate?{...built.candidate,binding}:null};
    };
    return {
        async prepareRequest(ownerId,locator,input){
            if(!locatorValid(locator)||!Array.isArray(input?.messages)||!input.messages.length||input.messages.length>24||!Array.isArray(input.attachments)||input.attachments.length>5||!await validateFreshReviewer(input.reviewer))throw new HistoryError('context_limit');
            return repository.withOwnerLock(ownerId,async tx=>{
                const dependencies=await tx.loadPreparedDependencies(locator,input.messages.map(row=>row.id),input.attachments.map(row=>row.id));
                try{return createPreparedRequest(ownerId,locator,input,dependencies,input.reviewer);}catch{throw new HistoryError('context_incomplete');}
            });
        },
        async prepareFresh(ownerId, locator, draft) {
            if (!locatorValid(locator) || typeof draft?.content !== 'string' || !draft.metadata || !Array.isArray(draft.actions)) throw new HistoryError('projection_refused');
            const prepared=draft.preparedRequest?readPreparedRequest(draft.preparedRequest):null;
            if(draft.preparedRequest&&(!prepared||prepared.ownerId!==ownerId||canonicalJSON(prepared.locator)!==canonicalJSON(locator)))throw new HistoryError('source_changed',409);
            const safeDraft = clone({content:draft.content,metadata:draft.metadata,actions:draft.actions,...(prepared?{sourceWindow:prepared.descriptor.rows.map(row=>row.id)}:{}),...(draft.operation?{operation:draft.operation}:{}),...(draft.recovery?{recovery:draft.recovery}:{})});
            const preparedData=await repository.withOwnerLock(ownerId, async tx => {
                const currentPolicy = await policy(tx,ownerId,null,prepared?.descriptor.reviewer);
                const bundle = await tx.loadFreshBundle(locator,safeDraft,LIMITS.prefixRows);
                const built = await build(tx,ownerId,locator,currentPolicy,renderer,bundle,safeDraft.actions,prepared);
                if (built.code) throw new HistoryError(built.code);
                const noticeOnly = isExactNotice(built.candidate)||isFixedNoteReceiptFallback(built.sourceSnapshot,freshActionManifest(built.sourceSnapshot,safeDraft.actions));
                if (!noticeOnly && !await tx.hasConsent()) throw new HistoryError('consent_required',412);
                safeDraft.createdAt=bundle.target.createdAt;
                return {ownerId,locator:clone(locator),draft:safeDraft,built,noticeOnly,prepared,previousDigest:bundle.previous?digest(historyAISourceRow(bundle.previous)):null};
            });
            const external=await captureExternal(preparedData.built);
            return createFreshPreparation({...preparedData,built:bindExternal(preparedData.built,external),external});
        },
        async reviewFresh(preparation, {signal} = {}) {
            const data = readFreshPreparation(preparation?.ticket);
            if (!data || data.noticeOnly) throw new HistoryError('projection_refused');
            return boundedReview(signal => (data.prepared?.review??verifyOnly)({ownerId:data.ownerId,policy:data.built.policy,translation:data.built.context.translation,question:data.prepared?.question??data.built.context.question,context:data.built.reviewContext,
                blocks:data.built.review.blocks.map(block=>({id:block.path,text:block.text})),manifest:data.built.review,signal,allowRepair:false,mediaParts:data.prepared?.mediaParts??[],
                authorizeInference:async()=>repository.withOwnerLock(data.ownerId,async tx=>{
                    if (!await tx.hasConsent()) throw new HistoryError('consent_required',412);
                    const bundle=await tx.loadFreshBundle(data.locator,data.draft,LIMITS.prefixRows);
                    const currentBuilt=await build(tx,data.ownerId,data.locator,await policy(tx,data.ownerId,data.external,data.prepared?.descriptor.reviewer),renderer,bundle,data.draft.actions,data.prepared);
                    if (!bindingEqual(currentBuilt.binding,data.built.binding)||(bundle.previous?digest(historyAISourceRow(bundle.previous)):null)!==data.previousDigest) throw new HistoryError('source_changed',409);
                })}),verifyMs,signal);
        },
        async certifyFresh(ownerId, locator, proof) {
            const data=readFreshHistoryProof(proof);
            if (!data||data.ownerId!==ownerId||canonicalJSON(data.locator)!==canonicalJSON(locator)) throw new HistoryError('projection_refused');
            if(data.external&&canonicalJSON((await captureExternal(data.built))?.evidence)!==canonicalJSON(data.external.evidence))throw new HistoryError('source_changed',409);
            // Canonical card fields are verified without a provider even when
            // the final semantic gate approves the entire display envelope.
            if (data.built.review.canonicalSources.length && typeof verifyCanonical!=='function') throw new HistoryError('verification_unavailable',503);
            for (const source of data.built.review.canonicalSources) {
                const checked=await verifyCanonical(`[[SCRIPTURE:${source.reference}]]`,{translation:source.translation});
                if (!checked.ok||checked.references.length!==1||checked.references[0].canonicalText!==source.text) throw new HistoryError('canonical_rejected');
            }
            return repository.withOwnerLock(ownerId,async tx=>{
                const currentPolicy=await policy(tx,ownerId,data.external,data.prepared?.descriptor.reviewer);
                const bundle=await tx.loadFreshBundle(locator,data.draft,LIMITS.prefixRows);
                const built=await build(tx,ownerId,locator,currentPolicy,renderer,bundle,data.draft.actions,data.prepared);
                if (!bindingEqual(built.binding,data.built.binding)||(bundle.previous?digest(historyAISourceRow(bundle.previous)):null)!==data.previousDigest) throw new HistoryError('source_changed',409);
                if (!data.noticeOnly&&!await tx.hasConsent()) throw new HistoryError('consent_required',412);
                const current=await tx.currentTime();
                // Preserve the exact prior target only. Prefix context remains
                // transient and normal source deletion still cascades versions.
                if (bundle.previous&&digest(historyAISourceRow(bundle.previous))!==digest(historyAISourceRow(bundle.target))) {
                    const previous=await build(tx,ownerId,locator,currentPolicy,renderer);
                    if (!await tx.findBinding(previous.binding)) await tx.createReview({...recordData(previous,locator,ownerId,current),state:'withheld',leaseToken:null,expiresAt:null,retryAfter:null,attemptCount:0,checkedAt:current});
                }
                const saved=await tx.saveFreshTarget(locator,bundle.target);
                if (digest(saved)!==digest(bundle.target)) throw new HistoryError('source_changed',409);
                if(data.draft.recovery){
                    const recoverySource={...built.sourceSnapshot,row:historyAISourceRow({...bundle.target,content:data.draft.recovery.content,metadata:data.draft.recovery.metadata})};
                    const recovery=blockedSnapshot(recoverySource,built.context,currentPolicy,'review_required');
                    if(!await tx.findBinding(recovery.binding))await tx.createReview({...recordData(recovery,locator,ownerId,current),state:'withheld',leaseToken:null,expiresAt:null,retryAfter:null,attemptCount:0,checkedAt:current});
                }
                const state=data.noticeOnly?'notice':'verified';
                let record=await tx.findBinding(built.binding);
                const actions=freshActionManifest(built.sourceSnapshot,data.draft.actions);
                const operational={state,canonicalPassed:!data.noticeOnly,semanticPassed:!data.noticeOnly,actionProofPassed:actions.length>0,reviewerModelId:data.noticeOnly?null:built.policy.reviewerModelId,issueCodes:[],checkedAt:current,updatedAt:current,retryAfter:null};
                if (!record) record=await tx.createReview({...recordData(built,locator,ownerId,current),...operational,freshEvidence:{version:1,sourceDigest:built.binding.sourceDigest,actions,...(data.prepared?{prepared:data.prepared.descriptor,...(data.external?{external:data.external}:{})}:{})},leaseToken:null,expiresAt:null,attemptCount:0});
                else if (record.state!==state&&!await tx.certifyFreshReview(record.id,operational)) throw new HistoryError('stale_lease',409);
                return {state,sourceDigest:built.binding.sourceDigest,row:clone(built.display)};
            });
        },
        async get(ownerId, locator) {
            if (!locatorValid(locator))
                return response(400, 'not_found');
            try {
                const read=external=>repository.withOwnerLock(ownerId, async (tx) => {
                    const prepared=await tx.loadPreparedReview?.(locator);
                    const descriptor=prepared?.descriptor;
                    const reviewerCurrent=!descriptor||await validateFreshReviewer(descriptor.reviewer);
                    const built = await build(tx, ownerId, locator, await policy(tx, ownerId,external,reviewerCurrent?descriptor?.reviewer:null), renderer,null,null,prepared);
                    if(!reviewerCurrent&&built.fixedOperational!==true)return{status:200,body:{state:'withheld',sourceDigest:built.binding.sourceDigest,row:fixedHistoryRow(built.sourceSnapshot.row,'withheld','policy_changed',built.binding.sourceDigest)}};
                    if(!external&&built.context.translation==='NKJV'&&built.candidate&&!fixedBuilt(built))return{externalBuilt:built};
                    if(external&&built.binding.sourceDigest!==external.sourceDigest)throw new HistoryError('source_changed',409);
                    const record = await tx.findBinding(built.binding);
                    if (recordMatches(record, built))
                        return { status: 200, body: { state: 'verified', sourceDigest: built.binding.sourceDigest, row: clone(record.sanitizedDisplay) } };
                    if (built.fixedOperational===true||isExactNotice(built.candidate ?? {})||(record?.state==='notice'&&bindingEqual(record,built.binding)&&digest(record.sourceSnapshot)===record.sourceDigest&&digest(record.sanitizedDisplay)===record.displayDigest&&isFixedNoteReceiptFallback(built.sourceSnapshot,record.freshEvidence?.actions)))
                        return { status: 200, body: { state: 'notice', sourceDigest: built.binding.sourceDigest, row: clone(built.display) } };
                    const readTime = await tx.currentTime();
                    const pending = record?.state === 'pending' && new Date(record.expiresAt) > readTime;
                    const state = pending ? 'pending' : 'withheld', code = pending ? 'pending' : built.code ?? record?.issueCodes?.[0] ?? 'review_required';
                    return { status: 200, body: { state, sourceDigest: built.binding.sourceDigest, row: fixedHistoryRow(built.sourceSnapshot.row, state, code, built.binding.sourceDigest) } };
                });
                const first=await read(null);
                if(!first.externalBuilt)return first;
                try{const external=await captureExternal(first.externalBuilt);if(!external)throw new HistoryError('verification_unavailable',503);return await read(external);}
                catch(error){const built=first.externalBuilt,code=SAFE_CODES.has(error.code)?error.code:'verification_unavailable';return{status:200,body:{state:'withheld',sourceDigest:built.binding.sourceDigest,row:fixedHistoryRow(built.sourceSnapshot.row,'withheld',code,built.binding.sourceDigest)}};}
            }
            catch (e) {
                return response(e.status ?? 503, SAFE_CODES.has(e.code) ? e.code : 'verification_unavailable');
            }
        },
        async recheck(ownerId, locator, expectedSourceDigest, { signal } = {}) {
            if (!locatorValid(locator) || !/^[a-f0-9]{64}$/.test(expectedSourceDigest ?? ''))
                return response(400, 'source_changed');
            let claim,external=null;
            try {
                const remoteBuilt=await repository.withOwnerLock(ownerId,async tx=>{const target=await tx.loadOwnedTarget(locator);return target?.metadata?.translation==='NKJV'?build(tx,ownerId,locator,await policy(tx,ownerId),renderer):null;});
                if(remoteBuilt)external=await captureExternal(remoteBuilt);
                claim = await repository.withOwnerLock(ownerId, async (tx) => {
                    const currentPolicy = await policy(tx, ownerId,external), built = await build(tx, ownerId, locator, currentPolicy, renderer), current = await tx.currentTime();
                    if (built.binding.sourceDigest !== expectedSourceDigest)
                        return { reply: response(409, 'source_changed', { sourceDigest: built.binding.sourceDigest }) };
                    await tx.expireLeases(current);
                    let record = await tx.findBinding(built.binding);
                    if(built.fixedOperational===true)return{reply:response(200,'notice',{state:'notice'})};
                    if (recordMatches(record, built))
                        return { reply: response(200, 'verified', { state: 'verified' }) };
                    if (record?.state === 'notice')
                        return { reply: response(200, 'notice', { state: 'notice' }) };
                    if (!await tx.hasConsent())
                        return { reply: response(412, 'consent_required') };
                    if (record?.state === 'pending')
                        return { reply: response(202, 'pending', { state: 'pending' }) };
                    if (record?.state === 'withheld' && (!record.retryAfter || new Date(record.retryAfter) > current))
                        return { reply: response(record.retryAfter ? 429 : 422, record.retryAfter ? 'retry_later' : record.issueCodes[0] ?? 'semantic_rejected', { state: 'withheld' }) };
                    const active = await tx.activeLease(current);
                    if (active)
                        return { reply: response(202, 'account_busy', { state: 'pending' }) };
                    if (built.code || built.candidate.kind === 'fixed-notice-only') {
                        if (!record)
                            record = await tx.createReview({ ...recordData(built, locator, ownerId, current), state: built.code ? 'withheld' : 'notice', leaseToken: null, expiresAt: null, retryAfter: null, attemptCount: 0, checkedAt: current });
                        return { reply: response(built.code ? 422 : 200, built.code ?? 'notice', { state: record.state }) };
                    }
                    const leaseToken = token(), expiresAt = new Date(current.getTime() + LIMITS.leaseMs);
                    record = record ? await tx.retryLease(record.id, { leaseToken, expiresAt, now: current }) : await tx.createReview({ ...recordData(built, locator, ownerId, current), state: 'pending', leaseToken, expiresAt, retryAfter: null, attemptCount: 1 });
                    if (!record)
                        return { reply: response(409, 'stale_lease') };
                    return { recordId: record.id, leaseToken, built, locator, ownerId };
                });
            }
            catch (e) {
                return response(e.status ?? 503, SAFE_CODES.has(e.code) ? e.code : 'verification_unavailable');
            }
            if (claim.reply)
                return claim.reply;
            let result, errorCode = null, retryAfter = null;
            try {
                const blocks = claim.built.review.blocks.map((block, i) => ({ id: `history-${i}`, text: block.text }));
                result = await boundedReview(signal => verifyOnly({ ownerId, policy: claim.built.policy, translation: claim.built.context.translation, question: claim.built.context.question, context: claim.built.reviewContext, blocks, manifest: claim.built.review, signal, allowRepair: false, authorizeInference: async () => repository.withOwnerLock(ownerId, async (tx) => { const current = await tx.currentTime(); if (!await tx.findLease(claim.recordId, claim.leaseToken, current))
                        throw new HistoryError('stale_lease', 409); if (!await tx.hasConsent())
                        throw new HistoryError('consent_required', 412); const currentBuilt = await build(tx, ownerId, locator, await policy(tx, ownerId,external), renderer); if (!bindingEqual(currentBuilt.binding, claim.built.binding))
                        throw new HistoryError('source_changed', 409); }) }), verifyMs, signal);
                if (result.reviewerModelId !== claim.built.policy.reviewerModelId)
                    errorCode = 'reviewer_changed';
                else if (result.repaired || !Array.isArray(result.blocks) || canonicalJSON(result.blocks) !== canonicalJSON(blocks))
                    errorCode = 'review_changed_text';
                else if (!result.canonicalPassed)
                    errorCode = 'canonical_rejected';
                else if (!result.verified || !result.semanticPassed)
                    errorCode = 'semantic_rejected';
                if(!errorCode&&external&&canonicalJSON((await captureExternal(claim.built))?.evidence)!==canonicalJSON(external.evidence))errorCode='source_changed';
            }
            catch (e) {
                errorCode = SAFE_CODES.has(e.code) ? e.code : 'verification_unavailable';
                if (errorCode === 'quota_exhausted')
                    retryAfter = e.retryAfter ?? new Date(now().getTime() + LIMITS.retryMs);
                else if (['verification_unavailable', 'verification_timeout'].includes(errorCode))
                    retryAfter = new Date(now().getTime() + LIMITS.retryMs);
            }
            // Source/context/policy/consent/lease re-read under short locks. Never create/upsert here.
            try {
                return await repository.withOwnerLock(ownerId, async (tx) => {
                    const current = await tx.currentTime(), record = await tx.findLease(claim.recordId, claim.leaseToken, current);
                    if (!record)
                        return response(409, 'stale_lease');
                    let built;
                    try {
                        built = await build(tx, ownerId, locator, await policy(tx, ownerId,external), renderer);
                    }
                    catch (e) {
                        // An aborted SQL transaction cannot finish a lease; let the outer DB-only retry reopen it.
                        if (isHistorySerializationConflict(e)) throw e;
                        await tx.finishLease(record.id, claim.leaseToken, current, { state: 'withheld', issueCodes: ['source_changed'], retryAfter: null });
                        return response(e.status ?? 409, e.code === 'not_found' ? 'not_found' : 'source_changed');
                    }
                    if (!bindingEqual(built.binding, claim.built.binding)) {
                        const changed = built.binding.sourceDigest !== claim.built.binding.sourceDigest ? 'source_changed' : built.binding.contextDigest !== claim.built.binding.contextDigest ? 'context_changed' : 'policy_changed';
                        await tx.finishLease(record.id, claim.leaseToken, current, { state: 'withheld', issueCodes: [changed], retryAfter: null });
                        return response(409, changed);
                    }
                    if (!await tx.hasConsent()) {
                        await tx.finishLease(record.id, claim.leaseToken, current, { state: 'withheld', issueCodes: ['consent_required'], retryAfter: null });
                        return response(412, 'consent_required');
                    }
                    const final = await tx.finishLease(record.id, claim.leaseToken, current, { state: errorCode ? 'withheld' : 'verified', issueCodes: errorCode ? [errorCode] : [], retryAfter, canonicalPassed: !errorCode, semanticPassed: !errorCode, actionProofPassed: !errorCode && built.requiresActionProof, reviewerModelId: result?.reviewerModelId ?? null });
                    if (!final)
                        return response(409, 'stale_lease');
                    return response(errorCode === 'quota_exhausted' ? 429 : ['verification_unavailable', 'verification_timeout'].includes(errorCode) ? 503 : errorCode ? 422 : 200, errorCode ?? 'verified', { state: errorCode ? 'withheld' : 'verified' });
                });
            }
            catch (e) {
                return response(e.status ?? 503, SAFE_CODES.has(e.code) ? e.code : 'verification_unavailable');
            }
        },
        async versions(ownerId, locator, after = null) {
            if (!locatorValid(locator) || after && !/^[A-Za-z0-9_-]{1,160}$/.test(after))
                return response(400, 'not_found');
            try {
                return await repository.withOwnerLock(ownerId, async (tx) => { if (!await tx.loadOwnedTarget(locator))
                    throw new HistoryError('not_found', 404); const records = await tx.targetVersions(locator, null, 21, after), page = records.slice(0, 20); return { status: 200, body: { versions: page.map(record => ({ reviewId: record.id, createdAt: record.createdAt, state: record.state, sourceDigest: record.sourceDigest })), next: records.length > 20 ? page.at(-1).id : null } }; });
            }
            catch (e) {
                return response(e.status ?? 503, SAFE_CODES.has(e.code) ? e.code : 'verification_unavailable');
            }
        },
        async download(ownerId, locator, reviewId = null) {
            if (!locatorValid(locator))
                return response(400, 'not_found');
            try {
                return await repository.withOwnerLock(ownerId, async (tx) => {
                    const target = await tx.loadOwnedTarget(locator);
                    if (!target)
                        throw new HistoryError('not_found', 404);
                    const reviews = await tx.targetVersions(locator, reviewId, 21);
                    if (reviews.length > 20)
                        throw new HistoryError('original_limit', 413);
                    const body = JSON.stringify({ formatVersion: 1, notice: 'Unverified archived source, supplied only as an owner download.', surface: locator.surface, parentId: locator.parentId, messageId: locator.messageId, current: target, versions: reviews.map(record => ({ reviewId: record.id, createdAt: record.createdAt, state: record.state, sourceSnapshot: record.sourceSnapshot })) }, null, 2);
                    if (Buffer.byteLength(body, 'utf8') > LIMITS.exportBytes)
                        throw new HistoryError('original_limit', 413);
                    return { status: 200, body, headers: { 'content-type': 'application/json; charset=utf-8', 'content-disposition': 'attachment; filename="sureword-saved-answer-original.json"', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "sandbox; default-src 'none'" } };
                });
            }
            catch (e) {
                return response(e.status ?? 503, SAFE_CODES.has(e.code) ? e.code : 'verification_unavailable');
            }
        }
    };
}
