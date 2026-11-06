/** Concrete DI bridge to existing canonical verifier/model meter. No real provider import/call here. */
import { HistoryError } from './service.mjs';
import { HISTORY_REVIEW_CONTEXT_CHARS } from '../verification-limits.mjs';
export function createVerifyOnlyAdapter({ houseChatModel, resolveVerificationModel, providerOptionsForReview, verifyScriptureDraft, verifyGeneratedAnswer, isQuotaError = () => false, allowEvidenceCompletion = false }) {
    return async (input) => {
        if (input.allowRepair !== false || input.question.length > 16000 || input.context.length > HISTORY_REVIEW_CONTEXT_CHARS || (input.canonicalContext!==undefined&&(typeof input.canonicalContext!=='string'||input.canonicalContext.length>HISTORY_REVIEW_CONTEXT_CHARS)) || input.manifest.canonicalSources.length > 120 || input.blocks.length > 32 || input.blocks.reduce((n, b) => n + b.text.length, 0) > 80000)
            throw new HistoryError('context_limit');
        input.signal.throwIfAborted();
        const coordinates=new Set();let occurrences=0,unknownCoordinates=0,sourcesChecked=0,blocksChecked=0,checkFailures=0;
        const reportBudget=()=>{try{console.info('[canonical-verse-budget]',{occurrences,unique:coordinates.size,budgeted:coordinates.size+unknownCoordinates,unknownCoordinates,limit:120,sources:input.manifest.canonicalSources.length,blocks:input.blocks.length,sourcesChecked,blocksChecked,checkFailures});}catch{/* Diagnostics cannot change a verification decision. */}};
        const accountVerses=(references,translation)=>{
            for(const reference of references){
                // Missing coordinates never collapse into a single undefined key.
                // The full canonical check ran first; only its budget is shared.
                const verses=Array.isArray(reference.verses)&&reference.verses.length?reference.verses:[null];
                for(const verse of verses){
                    occurrences++;
                    if(verse&&Number.isInteger(verse.order)&&verse.order>=1&&verse.order<=66&&Number.isInteger(verse.chapter)&&verse.chapter>=1&&verse.chapter<=150&&Number.isInteger(verse.verse)&&verse.verse>=1&&verse.verse<=176)coordinates.add(`${translation}:${verse.order}:${verse.chapter}:${verse.verse}`);
                    else unknownCoordinates++;
                    if(coordinates.size+unknownCoordinates>120){reportBudget();throw new HistoryError('context_limit');}
                }
            }
        };
        const canonicalFailure=()=>{checkFailures++;reportBudget();return{verified:false,canonicalPassed:false,semanticPassed:false,repaired:false,blocks:input.blocks,reviewerModelId:input.policy.reviewerModelId};};
        // Card/legacy verse fields are displayed separately from prose. Check
        // their exact source bytes before model resolution, not just the prose
        // blocks that happen to contain their reference or quotation.
        for (const source of input.manifest.canonicalSources) {
            if (!input.policy.supportedTranslations.includes(source.translation)) throw new HistoryError('unversioned_corpus');
            const checked = await verifyScriptureDraft(`[[SCRIPTURE:${source.reference}]]`, { translation: source.translation });
            input.signal.throwIfAborted();
            sourcesChecked++;
            if (!checked.ok || checked.references.length !== 1 || checked.references[0].canonicalText !== source.text)
                return canonicalFailure();
            accountVerses(checked.references,source.translation);
        }
        for (const block of input.blocks) {
            const checked = await verifyScriptureDraft(block.text, { translation: input.translation });
            input.signal.throwIfAborted();
            blocksChecked++;
            if (!checked.ok || checked.text !== block.text)
                return canonicalFailure();
            accountVerses(checked.references??[],input.translation);
        }
        reportBudget();
        let captured;
        try {
            const { definition } = await houseChatModel(input.ownerId); // Resolution only; do not return/log credentials.
            if (definition.id !== input.policy.reviewerModelId)
                throw new HistoryError('reviewer_changed', 409);
            const model = await resolveVerificationModel(input.ownerId, definition); // Actual utility:true middleware, no foreground scope.
            const result = await verifyGeneratedAnswer(input.blocks, { model, providerOptions: providerOptionsForReview(definition), translation: input.translation, question: input.question, context: input.context, canonicalContextForEvidence:input.canonicalContext, mediaParts:input.mediaParts??[],maxContextChars: HISTORY_REVIEW_CONTEXT_CHARS, requireCompleteContext: true, timeoutMs: 60000, allowRepair: false, historyReview: true, allowEvidenceCompletion, abortSignal: input.signal, beforeReview: input.authorizeInference, onError: error => { captured = error; } });
            if (captured)
                throw captured;
            if (result.issueCodes?.some(code => code === 'verification_timeout'))
                throw new HistoryError('verification_timeout', 503);
            if (result.issueCodes?.some(code => code === 'verification_unavailable'))
                throw new HistoryError('verification_unavailable', 503);
            if (result.repaired)
                throw new HistoryError('review_changed_text');
            // A clean rejection carries the reviewer's findings, in memory only, so a
            // fresh answer can be repaired and reviewed again (fresh-stream.ts).
            return { verified: result.verified, canonicalPassed: true, semanticPassed: result.verified, repaired: false, blocks: result.verified ? result.blocks : input.blocks, reviewerModelId: definition.id, ...(!result.verified && result.review ? { review: result.review } : {}) };
        }
        catch (error) {
            if (error instanceof HistoryError)
                throw error;
            if (isQuotaError(error))
                throw new HistoryError('quota_exhausted', 429, error.resetAt ?? null);
            throw new HistoryError('verification_unavailable', 503);
        }
    };
}
