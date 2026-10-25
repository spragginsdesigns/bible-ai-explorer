import { useEffect, useSyncExternalStore } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { addDismissed, dismissKey } from "./quizView";

/**
 * Chapters where the reader tapped "Not now" on the quiz offer. Device-local
 * by design (never synced): it is a courtesy for this phone's reading, capped
 * in `addDismissed`, and losing it only means the card comes back.
 */
const STORAGE_KEY = "sureword.quiz.dismissed.v1";

let dismissed: readonly string[] = [];
let hydration: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit() {
	listeners.forEach((listener) => listener());
}

function hydrate(): Promise<void> {
	hydration ??= AsyncStorage.getItem(STORAGE_KEY)
		.then((raw) => {
			if (!raw) return;
			const parsed: unknown = JSON.parse(raw);
			if (!Array.isArray(parsed)) return;
			const saved = parsed.filter((entry): entry is string => typeof entry === "string");
			// A dismissal made before hydration finished stays on top of the saved list.
			dismissed = dismissed.reduce<string[]>((list, key) => addDismissed(list, key), saved);
			emit();
		})
		.catch(() => {});
	return hydration;
}

export function dismissQuizOffer(book: number, chapter: number) {
	dismissed = addDismissed(dismissed, dismissKey(book, chapter));
	emit();
	AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(dismissed)).catch(() => {});
}

function subscribe(listener: () => void) {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

export function useQuizOfferDismissed(book: number, chapter: number): boolean {
	useEffect(() => {
		void hydrate();
	}, []);
	const key = dismissKey(book, chapter);
	return useSyncExternalStore(subscribe, () => dismissed.includes(key));
}
