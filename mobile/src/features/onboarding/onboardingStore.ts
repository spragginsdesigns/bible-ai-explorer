import { useSyncExternalStore } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Which conversation is this account's welcome ("Walk with me"), so the
 * chat screen knows when to show the Read it to me bar and wire the cards.
 * The server is the record (`User.onboardingConversationId`); this is the
 * id it last returned, kept per account so a relaunch remembers it.
 */

const STORAGE_KEY = "sureword.onboarding.v1";

interface OnboardingSnapshot {
	/** Clerk user id the id below belongs to. */
	userId: string | null;
	welcomeConversationId: string | null;
}

let snapshot: OnboardingSnapshot = { userId: null, welcomeConversationId: null };
let hydrated = false;
const listeners = new Set<() => void>();

function set(next: OnboardingSnapshot) {
	snapshot = next;
	AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => {});
	listeners.forEach((listener) => listener());
}

export async function hydrateOnboarding(): Promise<void> {
	if (hydrated) return;
	hydrated = true;
	try {
		const raw = await AsyncStorage.getItem(STORAGE_KEY);
		if (!raw) return;
		const parsed = JSON.parse(raw) as Partial<OnboardingSnapshot>;
		snapshot = {
			userId: typeof parsed.userId === "string" ? parsed.userId : null,
			welcomeConversationId:
				typeof parsed.welcomeConversationId === "string" ? parsed.welcomeConversationId : null,
		};
		listeners.forEach((listener) => listener());
	} catch {
		// Unreadable cache: the next start call fills it again.
	}
}

export function rememberWelcomeConversation(userId: string, conversationId: string) {
	set({ userId, welcomeConversationId: conversationId });
}

function subscribe(listener: () => void) {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

/** The welcome conversation id for this account, or null. */
export function useWelcomeConversationId(userId: string | null | undefined): string | null {
	const current = useSyncExternalStore(subscribe, () => snapshot);
	return userId && current.userId === userId ? current.welcomeConversationId : null;
}
