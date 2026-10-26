import type { AppTarget, ChoiceCardOutput, OnboardingStep, TourStop } from "./onboarding-rules";

/**
 * The web half of "Walk with me" (docs/onboarding/PLAN.md) that has no React
 * in it: reading the presentChoices and showInApp tool parts into cards,
 * deciding which card in a thread still takes a tap, where on the web each
 * spotlight target lives, and what voice mode reads for a message.
 *
 * Import-free at runtime (types only) so `tests/guide-cards.test.mjs` can
 * load it under `node --test`. The vocabulary checks are passed in by the
 * caller (`isOnboardingStep`, `isAppTarget` from `onboarding-rules.ts`) for
 * the same reason.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function stringList(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim() !== "") : [];
}

/**
 * A presentChoices output as the client can trust it. The server already ran
 * `resolveChoiceCard`, but a stored row outlives any deploy, so the shape is
 * checked again rather than assumed.
 */
export function parseChoiceCard(
	output: unknown,
	isStep: (value: unknown) => value is OnboardingStep,
): ChoiceCardOutput | null {
	if (!isRecord(output) || !isStep(output.step) || typeof output.question !== "string") return null;
	return {
		step: output.step,
		question: output.question,
		options: stringList(output.options),
		allowOther: output.allowOther === true,
		skipLabel: typeof output.skipLabel === "string" && output.skipLabel.trim() ? output.skipLabel : "Skip for now",
	};
}

export interface ShowInAppCard {
	target: AppTarget;
	caption: string;
	/** Only for target "tour": the stops to play, in order. */
	stops?: TourStop[];
}

export function parseShowInApp(
	output: unknown,
	isTarget: (value: unknown) => value is AppTarget,
): ShowInAppCard | null {
	if (!isRecord(output) || !isTarget(output.target) || typeof output.caption !== "string") return null;
	const stops = Array.isArray(output.stops)
		? output.stops.flatMap((stop): TourStop[] =>
				isRecord(stop) && isTarget(stop.target) && typeof stop.caption === "string"
					? [{ target: stop.target, caption: stop.caption }]
					: [],
			)
		: [];
	return {
		target: output.target,
		caption: output.caption,
		...(stops.length > 0 ? { stops } : {}),
	};
}

/**
 * The seeded first message's card carries a `welcome-` tool call id
 * (`welcomeParts` in src/lib/onboarding.ts), which is how a client knows this
 * conversation is the welcome without asking the server.
 */
export function isWelcomeToolCallId(value: unknown): boolean {
	return typeof value === "string" && value.startsWith("welcome-");
}

export interface CardThreadMessage {
	id: string;
	role: "user" | "assistant";
	content: string;
	choiceCard?: ChoiceCardOutput;
}

export interface CardState {
	/** The one card that still takes a tap: the newest, unanswered, and not mid-answer. */
	active: boolean;
	/** What they replied with, for an answered card. */
	answer: string | null;
}

/**
 * Every card's state in one pass. Only the newest message's card can be live,
 * and only while nothing is streaming: an older card's buttons would send an
 * answer to a question SureWord has already moved past.
 */
export function cardStates(messages: readonly CardThreadMessage[], busy: boolean): Record<string, CardState> {
	const states: Record<string, CardState> = {};
	messages.forEach((message, index) => {
		if (message.role !== "assistant" || !message.choiceCard) return;
		const next = messages[index + 1];
		const isLast = index === messages.length - 1;
		states[message.id] = {
			active: isLast && !busy,
			answer: next?.role === "user" ? next.content.trim() || null : null,
		};
	});
	return states;
}

/** John 3:16 in the reader: the verse the tour ends on when no verse is on screen. */
export const TOUR_VERSE_ROUTE = "/bible/chapter?book=43&chapter=3&verse=16";

/**
 * Where on the web a target lives, for when it is not on the current screen.
 * Tabs are absent on purpose: the navigation is on every screen (the bottom
 * bar on phones, the sidebar on desktop), so they never need a trip.
 */
export const GUIDE_TARGET_ROUTES: Readonly<Partial<Record<AppTarget, string>>> = {
	"today.cross": "/today",
	"today.learn": "/today",
	"today.plan": "/today",
	"reader.verse": TOUR_VERSE_ROUTE,
	"study.sermons": "/study",
	"study.notes": "/study",
	"settings.church": "/settings#church",
	"settings.textSize": "/settings#appearance",
	"chat.mic": "/",
};

export function routeForTarget(target: AppTarget): string | null {
	return GUIDE_TARGET_ROUTES[target] ?? null;
}

export type VoiceItem = { messageId: string } | { step: OnboardingStep };

/**
 * What voice mode reads for one of SureWord's messages: the message, then the
 * card's scripted question when there is one. An "other" card has no
 * scripted line to share, and its question is already in the message.
 */
export function voiceItemsFor(message: { id: string; choiceCard?: ChoiceCardOutput }): VoiceItem[] {
	const items: VoiceItem[] = [{ messageId: message.id }];
	if (message.choiceCard && message.choiceCard.step !== "other") items.push({ step: message.choiceCard.step });
	return items;
}

/**
 * When voice mode starts (switched on, or the welcome opened with it on), the
 * newest message is read and the rest count as already heard, so turning it on
 * never reads the whole history back. A reply still being written is the
 * newest one, so everything already settled counts as heard.
 */
export function alreadyHeardOnStart(messages: readonly { id: string; role: string; isStreaming?: boolean }[]): string[] {
	const assistant = messages.filter((message) => message.role === "assistant");
	const settled = assistant.filter((message) => !message.isStreaming).map((message) => message.id);
	return assistant.at(-1)?.isStreaming ? settled : settled.slice(0, -1);
}
