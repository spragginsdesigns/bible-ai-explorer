import { API_URL, ApiError, apiJson, makeAuthedFetch, type GetToken } from "@/lib/api";
import {
	parseCard,
	parseReviewAcknowledgement,
	type LearnCard,
	type LearnReviewAcknowledgement,
	type LearnReviewOperation,
	type LearnToday,
} from "./learn";
import { LearnReviewFailure, type LearnConflictCode } from "./learnSync";
import { loadSuggestions, type LearnSuggestion } from "./suggestions";

export function fetchLearnToday(getToken: GetToken): Promise<LearnToday> {
	return apiJson<LearnToday>(getToken, "/api/learn/today");
}

/** Suggested verses. Never rejects: a failure is "no suggestions today". */
export function fetchLearnSuggestions(getToken: GetToken): Promise<LearnSuggestion[]> {
	return loadSuggestions(() => apiJson<unknown>(getToken, "/api/learn/suggestions"));
}

function isConflictCode(value: unknown): value is Exclude<LearnConflictCode, "missing"> {
	return value === "revision_conflict" || value === "operation_id_reused";
}

export async function reviewLearnCard(
	getToken: GetToken,
	id: string,
	payload: LearnReviewOperation,
): Promise<LearnReviewAcknowledgement> {
	let response: Response;
	try {
		response = await makeAuthedFetch(getToken)(
			`${API_URL}/api/learn/${encodeURIComponent(id)}/review`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(payload),
			},
		);
	} catch (error) {
		if (error instanceof ApiError) {
			throw new LearnReviewFailure(error.message, {
				offline: error.isNetworkError || error.isTimeout,
			});
		}
		if (error instanceof TypeError) {
			throw new LearnReviewFailure("You appear to be offline.", { offline: true });
		}
		throw error;
	}

	let body: unknown = null;
	try { body = await response.json(); } catch { /* The status still identifies the failure. */ }
	if (response.ok) return parseReviewAcknowledgement(body, payload.operationId);

	if (response.status === 409) {
		const conflict = body as { code?: unknown; currentCard?: unknown; error?: unknown } | null;
		if (conflict && isConflictCode(conflict.code)) {
			let currentCard: LearnCard | null = null;
			if (conflict.currentCard !== null && conflict.currentCard !== undefined) {
				currentCard = parseCard(conflict.currentCard);
			}
			throw new LearnReviewFailure(
				typeof conflict.error === "string" ? conflict.error : conflict.code,
				{ code: conflict.code, currentCard },
			);
		}
	}
	if (response.status === 404) {
		throw new LearnReviewFailure("This verse is no longer on the server.", {
			code: "missing",
			currentCard: null,
		});
	}
	const errorBody = body as { error?: unknown } | null;
	throw new LearnReviewFailure(
		typeof errorBody?.error === "string" ? errorBody.error : `Review failed: ${response.status}`,
	);
}
