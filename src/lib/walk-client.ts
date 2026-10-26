import type { GettingStartedKey, OnboardingStep } from "@/lib/onboarding-rules";

/**
 * The browser's calls to the "Walk with me" routes (docs/onboarding/PLAN.md),
 * mirroring `mobile/src/features/onboarding/api.ts`. Same-origin, so the
 * Clerk cookie carries the account. None of these send study content to a
 * model, so none of them go through the AI consent gate.
 */

export type WalkStartResult =
	| { status: "active"; conversationId: string; created: boolean }
	| { status: "done" }
	| { status: "not_eligible" };

/**
 * "auto" after sign-in (only a brand-new account gets a welcome), "manual"
 * from Settings (anyone, and it picks up where the welcome stopped). Null when
 * the request failed: the welcome is never worth an error on screen.
 */
export async function startWalkWithMe(mode: "auto" | "manual"): Promise<WalkStartResult | null> {
	try {
		const response = await fetch("/api/onboarding/start", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ mode }),
		});
		if (!response.ok) return null;
		const data: unknown = await response.json();
		if (typeof data !== "object" || data === null) return null;
		const result = data as Record<string, unknown>;
		if (result.status === "active" && typeof result.conversationId === "string") {
			return { status: "active", conversationId: result.conversationId, created: result.created === true };
		}
		if (result.status === "done" || result.status === "not_eligible") return { status: result.status };
		return null;
	} catch {
		return null;
	}
}

/** Open a conversation in Chat. The chat screen's ?conversationId= effect does the switch. */
export function openWelcomeConversation(router: { push: (href: string) => void }, conversationId: string): void {
	router.push(`/?conversationId=${encodeURIComponent(conversationId)}`);
}

export interface GettingStartedProgress {
	show: boolean;
	items: Record<GettingStartedKey, boolean>;
}

function parseProgress(data: unknown): GettingStartedProgress | null {
	if (typeof data !== "object" || data === null) return null;
	const record = data as Record<string, unknown>;
	if (typeof record.show !== "boolean" || typeof record.items !== "object" || record.items === null) return null;
	const items = record.items as Record<string, unknown>;
	return {
		show: record.show,
		items: {
			readChapter: items.readChapter === true,
			tapVerse: items.tapVerse === true,
			dailyWord: items.dailyWord === true,
			learnVerse: items.learnVerse === true,
			church: items.church === true,
		},
	};
}

export async function fetchGettingStarted(signal?: AbortSignal): Promise<GettingStartedProgress | null> {
	const response = await fetch("/api/onboarding/progress", { cache: "no-store", signal });
	if (!response.ok) return null;
	return parseProgress(await response.json());
}

export async function dismissGettingStarted(): Promise<GettingStartedProgress | null> {
	const response = await fetch("/api/onboarding/progress", {
		method: "PATCH",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ dismissed: true }),
	});
	if (!response.ok) throw new Error("Could not hide Getting started. Try again.");
	return parseProgress(await response.json());
}

export type WelcomeVoiceAnswer =
	| { status: "ready"; streamUrl: string }
	| { status: "device"; text: string };

/**
 * How to read one welcome message or one card's question aloud. Null on a
 * 404: the message is not saved yet (it lands right after the stream ends),
 * or is not part of this account's welcome. Throws on anything else.
 */
export async function requestWelcomeVoice(
	request: { messageId: string } | { step: OnboardingStep },
	signal?: AbortSignal
): Promise<WelcomeVoiceAnswer | null> {
	const response = await fetch("/api/onboarding/audio", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(request),
		signal,
	});
	if (response.status === 404) return null;
	if (!response.ok) throw new Error(`Voice request failed (${response.status})`);
	const data: unknown = await response.json();
	if (typeof data !== "object" || data === null) throw new Error("Voice answer was invalid.");
	const answer = data as Record<string, unknown>;
	if (answer.status === "ready" && typeof answer.streamUrl === "string" && answer.streamUrl.startsWith("/")) {
		return { status: "ready", streamUrl: answer.streamUrl };
	}
	if (answer.status === "device" && typeof answer.text === "string") return { status: "device", text: answer.text };
	throw new Error("Voice answer was invalid.");
}
