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

/**
 * Mechanical failures a prose repair can fix by itself, because the canonical
 * text it needs is already in the checked block's references. Source outages
 * and limits are not here: rewriting cannot change them.
 */
const REPAIRABLE_MECHANICAL = new Set(["quote_mismatch", "unattributed_quote", "invalid_reference", "unknown_book", "malformed_placeholder"]);

/**
 * A draft the exact-text check already failed for a repairable reason cannot
 * pass review, so asking the reviewer only adds 10-15s before the same repair.
 * Its findings are the check's own, in memory only. The repaired text still
 * goes through the full check and the independent review before release.
 */
function mechanicalReview(checked: CheckedBlock[]): AnswerReview | null {
	const errors = checked.flatMap(block => block.issues.filter(issue => issue.severity === "error"));
	if (!errors.length || !errors.every(issue => REPAIRABLE_MECHANICAL.has(issue.code))) return null;
	return {
		pass: false,
		issues: errors.map(issue => {
			const detail = issue as typeof issue & { excerpt?: unknown; reference?: unknown };
			const excerpt = typeof detail.excerpt === "string" && detail.excerpt ? ` Quoted text: "${detail.excerpt.slice(0, 600)}".` : "";
			const reference = typeof detail.reference === "string" && detail.reference ? ` Cited: ${detail.reference}. Quote it word for word from the canonical evidence.` : "";
			return `${issue.message}${excerpt}${reference}`;
		}),
		requiredReferences: [],
	};
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
			// A draft whose only failures are repairable exact-text ones goes
			// straight to repair with those findings (fresh answers only). Any
			// other invalid draft is still reviewed for missing evidence so repair
			// receives the actual failure, never an instruction to just omit it.
			const mechanical = deps.allowRepair === false ? null : mechanicalReview(checked);
			const review = mechanical ?? await deps.review(checked);
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
