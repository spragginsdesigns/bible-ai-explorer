/** Concrete DI bridge to existing canonical verifier/model meter. No real provider import/call here. */
import { HistoryError } from './service.mjs';
export function createVerifyOnlyAdapter({ houseChatModel, resolveVerificationModel, providerOptionsForReview, verifyScriptureDraft, verifyGeneratedAnswer, isQuotaError = () => false, allowEvidenceCompletion = false }) {
    return async (input) => {
        if (input.allowRepair !== false || input.question.length > 16000 || input.context.length > 64000 || (input.canonicalContext!==undefined&&(typeof input.canonicalContext!=='string'||input.canonicalContext.length>64000)) || input.blocks.length > 32 || input.blocks.reduce((n, b) => n + b.text.length, 0) > 80000)
            throw new HistoryError('context_limit');
        input.signal.throwIfAborted();
        let verseCount = 0;
        // Card/legacy verse fields are displayed separately from prose. Check
        // their exact source bytes before model resolution, not just the prose
        // blocks that happen to contain their reference or quotation.
        for (const source of input.manifest.canonicalSources) {
            if (!input.policy.supportedTranslations.includes(source.translation)) throw new HistoryError('unversioned_corpus');
            const checked = await verifyScriptureDraft(`[[SCRIPTURE:${source.reference}]]`, { translation: source.translation });
            input.signal.throwIfAborted();
            if (!checked.ok || checked.references.length !== 1 || checked.references[0].canonicalText !== source.text)
                return { verified: false, canonicalPassed: false, semanticPassed: false, repaired: false, blocks: input.blocks, reviewerModelId: input.policy.reviewerModelId };
            verseCount += checked.references[0].verses.length;
            if (verseCount > 120) throw new HistoryError('context_limit');
        }
        for (const block of input.blocks) {
            const checked = await verifyScriptureDraft(block.text, { translation: input.translation });
            input.signal.throwIfAborted();
            if (!checked.ok || checked.text !== block.text)
                return { verified: false, canonicalPassed: false, semanticPassed: false, repaired: false, blocks: input.blocks, reviewerModelId: input.policy.reviewerModelId };
            verseCount += (checked.references ?? []).reduce((n, ref) => n + (ref.verses?.length ?? 0), 0);
            if (verseCount > 120)
                throw new HistoryError('context_limit');
        }
        let captured;
        try {
            const { definition } = await houseChatModel(input.ownerId); // Resolution only; do not return/log credentials.
            if (definition.id !== input.policy.reviewerModelId)
                throw new HistoryError('reviewer_changed', 409);
            const model = await resolveVerificationModel(input.ownerId, definition); // Actual utility:true middleware, no foreground scope.
            const result = await verifyGeneratedAnswer(input.blocks, { model, providerOptions: providerOptionsForReview(definition), translation: input.translation, question: input.question, context: input.context, canonicalContextForEvidence:input.canonicalContext, mediaParts:input.mediaParts??[],maxContextChars: 64000, requireCompleteContext: true, timeoutMs: 60000, allowRepair: false, historyReview: true, allowEvidenceCompletion, abortSignal: input.signal, beforeReview: input.authorizeInference, onError: error => { captured = error; } });
            if (captured)
                throw captured;
            if (result.issueCodes?.some(code => code === 'verification_timeout'))
                throw new HistoryError('verification_timeout', 503);
            if (result.issueCodes?.some(code => code === 'verification_unavailable'))
                throw new HistoryError('verification_unavailable', 503);
            if (result.repaired)
                throw new HistoryError('review_changed_text');
            return { verified: result.verified, canonicalPassed: true, semanticPassed: result.verified, repaired: false, blocks: result.verified ? result.blocks : input.blocks, reviewerModelId: definition.id };
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
