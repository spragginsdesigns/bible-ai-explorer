import { ApiError, apiJson, type GetToken } from "@/lib/api";
import type { GettingStartedKey, OnboardingStep } from "./onboardingRules";

/** The four `/api/onboarding*` requests ("Walk with me", docs/onboarding/PLAN.md). */

export type OnboardingStartResult =
	| { status: "active"; conversationId: string; created: boolean }
	| { status: "done" }
	| { status: "not_eligible" };

/** "auto" after sign-in (new accounts only); "manual" from Settings, for anyone. */
export function startOnboarding(getToken: GetToken, mode: "auto" | "manual") {
	return apiJson<OnboardingStartResult>(getToken, "/api/onboarding/start", { method: "POST", body: { mode } });
}

export interface GettingStartedProgress {
	show: boolean;
	items: Record<GettingStartedKey, boolean>;
}

export function fetchGettingStarted(getToken: GetToken) {
	return apiJson<GettingStartedProgress>(getToken, "/api/onboarding/progress");
}

export function dismissGettingStarted(getToken: GetToken) {
	return apiJson<GettingStartedProgress>(getToken, "/api/onboarding/progress", {
		method: "PATCH",
		body: { dismissed: true },
	});
}

export type OnboardingVoiceAnswer =
	| { status: "ready"; streamUrl: string; characters: number }
	| { status: "device"; text: string; reason: string; characters: number };

/**
 * Ask the server how to read one welcome message or one card's question.
 * Null when there is nothing to read (a 404: the message is not saved yet, or
 * is not part of this account's welcome).
 */
export async function requestVoice(
	getToken: GetToken,
	request: { messageId: string } | { step: OnboardingStep },
): Promise<OnboardingVoiceAnswer | null> {
	try {
		return await apiJson<OnboardingVoiceAnswer>(getToken, "/api/onboarding/audio", { method: "POST", body: request });
	} catch (error) {
		if (error instanceof ApiError && error.status === 404) return null;
		throw error;
	}
}
