/** No draft text may cross the output boundary before the whole answer passes. */
export interface AnswerBlock { id: string; text: string }
export interface AnswerReview { pass: boolean; issues: string[]; requiredReferences: string[] }
export interface CheckedBlock extends AnswerBlock {
	ok: boolean;
	issues: readonly { code: string; message: string; severity: string }[];
	references: readonly unknown[];
}
export interface AnswerGateDependencies {
	check: (block: AnswerBlock) => Promise<CheckedBlock>;
	review: (blocks: CheckedBlock[]) => Promise<AnswerReview>;
	repair: (blocks: CheckedBlock[], review: AnswerReview) => Promise<AnswerBlock[]>;
	/** Internal saved-history checks never repair or replace persisted content. */
	allowRepair?: boolean;
	/**
	 * Findings from a later review that rejected an earlier approved version.
	 * The first step repairs against them; the result is checked and reviewed
	 * again exactly like any repair.
	 */
	initialReview?: AnswerReview;
	onError?: (error: unknown) => void;
	fallback: string;
}
export interface GatedAnswer {
	blocks: AnswerBlock[]; verified: boolean; repaired: boolean; issueCodes: string[];
	/** In-memory only, on a rejection: the findings a further repair needs. Never logged or stored. */
	review?: AnswerReview;
}

/** Repairs prose only. Successful tools and their side effects are never retried. */
export async function gateAnswer(blocks: AnswerBlock[], deps: AnswerGateDependencies): Promise<GatedAnswer> {
	const ids = blocks.map(block => block.id);
	const failure = (codes: string[], repaired: boolean): GatedAnswer => ({
		blocks: blocks.length ? blocks.map((block, i) => ({ id: block.id, text: i === 0 ? deps.fallback : "" })) : [{ id: "verified-answer", text: deps.fallback }],
		verified: false, repaired, issueCodes: codes,
	});
	if (new Set(ids).size !== ids.length || blocks.length > 32 || blocks.reduce((n, block) => n + block.text.length, 0) > 80_000) return failure(["answer_limit"], false);
	let candidate = blocks;
	let repaired = false;
	let lastReview: AnswerReview | undefined;
	if (deps.initialReview) {
		if (deps.allowRepair === false) return failure(["repair_not_allowed"], false);
		try {
			const checked = await Promise.all(candidate.map(block => deps.check(block)));
			candidate = await deps.repair(checked, deps.initialReview);
			repaired = true;
			if (candidate.length !== ids.length || candidate.some((block, i) => block.id !== ids[i] || typeof block.text !== "string") || candidate.reduce((n, block) => n + block.text.length, 0) > 80_000) return failure(["repair_shape"], true);
		} catch (error) {
			try { deps.onError?.(error); } catch { /* Still withhold. */ }
			return failure(["verification_unavailable"], repaired);
		}
	}
	for (let attempt = 0; attempt < 2; attempt++) {
		try {
			const checked = await Promise.all(candidate.map(block => deps.check(block)));
			// Even a mechanically invalid draft is reviewed for missing evidence so
			// repair receives the actual failure, never an instruction to just omit it.
			const review = await deps.review(checked);
			lastReview = review;
			if (checked.every(block => block.ok) && review.pass && review.issues.length === 0 && review.requiredReferences.length === 0) {
				return { blocks: checked.map(({ id, text }) => ({ id, text })), verified: true, repaired, issueCodes: [] };
			}
			const codes = [...new Set(checked.flatMap(block => block.issues.filter(issue => issue.severity === "error").map(issue => issue.code)))];
			if (attempt === 1 || deps.allowRepair === false) return { ...failure([...codes, "review_rejected"], repaired), review };
			candidate = await deps.repair(checked, review);
			repaired = true;
			if (candidate.length !== ids.length || candidate.some((block, i) => block.id !== ids[i] || typeof block.text !== "string") || candidate.reduce((n, block) => n + block.text.length, 0) > 80_000) return failure(["repair_shape"], true);
		} catch (error) {
			try { deps.onError?.(error); } catch { /* Still withhold. */ }
			// Provider failures, invalid structured output and source outages fail
			// closed. Raw draft/exception text never becomes a displayed answer.
			return failure(["verification_unavailable"], repaired);
		}
	}
	return { ...failure(["review_rejected"], repaired), ...(lastReview ? { review: lastReview } : {}) };
}
