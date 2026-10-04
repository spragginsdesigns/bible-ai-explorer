import {
	parseCard,
	parseReviewAcknowledgement,
	parseToday,
	type LearnCard,
	type LearnReviewAcknowledgement,
	type LearnReviewOperation,
	type LearnToday,
} from "./learn";
import { loadSuggestions, type LearnSuggestion } from "./suggestions";
// The offline review queue is shared with Android, the same way
// readingLogClient wraps Android's reading journal core.
import { LearnReviewFailure, type LearnConflictCode } from "../../../mobile/src/features/learn/learnSync";

/**
 * Web transport for Learn, the twin of mobile/src/features/learn/api.ts. Every
 * call carries a Bearer token for the account the Learn session belongs to,
 * so a session cookie changed by another tab can never send one account's
 * saved reviews as another's. Network failures and timeouts surface as
 * offline LearnReviewFailures, which the sync store treats as "keep the
 * reviews on this device and retry", never as a lost review.
 */

/** Resolves the session owner's token, or throws once that account is gone. */
export type LearnTokenSource = () => Promise<string | null>;

const TIMEOUT_MS = 15_000;

async function learnRequest(
	getToken: LearnTokenSource,
	path: string,
	body?: object
): Promise<{ response: Response; data: unknown }> {
	const token = await getToken();
	if (!token) throw new LearnReviewFailure("Sign in again to sync Learn.");
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
	try {
		let response: Response;
		try {
			response = await fetch(path, {
				method: body ? "POST" : "GET",
				cache: "no-store",
				credentials: "omit",
				signal: controller.signal,
				headers: {
					Authorization: `Bearer ${token}`,
					...(body ? { "Content-Type": "application/json" } : {}),
				},
				...(body ? { body: JSON.stringify(body) } : {}),
			});
		} catch {
			// A TypeError (no network) or an AbortError (the timeout).
			throw new LearnReviewFailure("You appear to be offline.", { offline: true });
		}
		let data: unknown = null;
		try {
			data = await response.json();
		} catch {
			// The status still identifies the failure.
		}
		return { response, data };
	} finally {
		clearTimeout(timeout);
	}
}

function errorText(data: unknown, fallback: string): string {
	const body = data as { error?: unknown } | null;
	return typeof body?.error === "string" ? body.error : fallback;
}

export async function fetchLearnToday(getToken: LearnTokenSource): Promise<LearnToday> {
	const { response, data } = await learnRequest(getToken, "/api/learn/today");
	if (!response.ok) throw new Error(errorText(data, "Could not load Learn. Please try again."));
	return parseToday(data);
}

/** Suggested verses. Never rejects: a failure is "no suggestions today". */
export function fetchLearnSuggestions(getToken: LearnTokenSource): Promise<LearnSuggestion[]> {
	return loadSuggestions(async () => {
		const { response, data } = await learnRequest(getToken, "/api/learn/suggestions");
		if (!response.ok) throw new Error("Suggestions unavailable");
		return data;
	});
}

function isConflictCode(value: unknown): value is Exclude<LearnConflictCode, "missing"> {
	return value === "revision_conflict" || value === "operation_id_reused";
}

export async function reviewLearnCard(
	getToken: LearnTokenSource,
	id: string,
	payload: LearnReviewOperation
): Promise<LearnReviewAcknowledgement> {
	const { response, data } = await learnRequest(
		getToken,
		`/api/learn/${encodeURIComponent(id)}/review`,
		payload
	);
	if (response.ok) return parseReviewAcknowledgement(data, payload.operationId);

	if (response.status === 409) {
		const conflict = data as { code?: unknown; currentCard?: unknown; error?: unknown } | null;
		if (conflict && isConflictCode(conflict.code)) {
			let currentCard: LearnCard | null = null;
			if (conflict.currentCard !== null && conflict.currentCard !== undefined) {
				currentCard = parseCard(conflict.currentCard);
			}
			throw new LearnReviewFailure(
				typeof conflict.error === "string" ? conflict.error : conflict.code,
				{ code: conflict.code, currentCard }
			);
		}
	}
	if (response.status === 404) {
		throw new LearnReviewFailure("This verse is no longer on the server.", {
			code: "missing",
			currentCard: null,
		});
	}
	throw new LearnReviewFailure(errorText(data, `Review failed: ${response.status}`));
}
