import { useSyncExternalStore } from "react";
import type { SharedChatDraft } from "./shareIntake";

/**
 * The one share waiting to become a chat. It is held here, outside any screen,
 * because the chat screen does not exist while the user is signed out: the
 * share waits through sign-in and is applied when the chat mounts signed in.
 * A newer share replaces an unapplied older one.
 */
let pending: SharedChatDraft | null = null;
const listeners = new Set<() => void>();

function emit(): void {
	for (const listener of listeners) listener();
}

export function setPendingShare(draft: SharedChatDraft): void {
	pending = draft;
	emit();
}

/** Hand the pending share to exactly one caller. */
export function takePendingShare(): SharedChatDraft | null {
	const draft = pending;
	if (draft) {
		pending = null;
		emit();
	}
	return draft;
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

export function usePendingShare(): SharedChatDraft | null {
	return useSyncExternalStore(subscribe, () => pending, () => pending);
}
