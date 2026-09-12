/**
 * When to show the OS notification permission dialog.
 *
 * Asking seconds after sign-in, before the user has seen anything worth being
 * notified about, is the classic way to collect a permanent "Don't allow". The
 * dialog now waits for a moment that explains itself: the first answer that
 * settles in chat (so "your answer is ready" means something) or the first
 * visit to Pick Up Your Cross (so the morning word means something). It is
 * shown at most once per install, except when the user switches notifications
 * on in Settings, which is an explicit request and always asks.
 *
 * This module has no React Native imports so the decision stays unit-testable.
 */

export type PermissionTrigger = "first-answer" | "cross-visit" | "settings-enabled";

export interface PermissionOsStatus {
	granted: boolean;
	/** False once the OS will no longer show the dialog (Android after repeated denial). */
	canAskAgain: boolean;
}

export interface PermissionDecisionInput {
	settings: { enabled: boolean; chatReplies: boolean };
	/** The dialog was already shown on this install. */
	asked: boolean;
	osStatus: PermissionOsStatus;
	trigger: PermissionTrigger;
}

export function shouldRequestPermission({
	settings,
	asked,
	osStatus,
	trigger,
}: PermissionDecisionInput): boolean {
	// Nothing to ask for: registration proceeds exactly as it always has.
	if (osStatus.granted) return false;
	// The user asked for notifications themselves, so the once-per-install cap
	// does not apply. A request the OS will not show is a harmless no-op.
	if (trigger === "settings-enabled") return true;
	if (!settings.enabled && !settings.chatReplies) return false;
	if (asked) return false;
	return osStatus.canAskAgain;
}

type TriggerListener = (trigger: PermissionTrigger) => void;

let listener: TriggerListener | null = null;
let pending: PermissionTrigger | null = null;

/**
 * Report a moment when asking would make sense. Cheap and safe to call on
 * every answer or every focus: the listener decides, and the persisted flag
 * turns repeats into no-ops.
 *
 * A trigger that fires before the listener exists is held, because child
 * screen effects run before the (app) layout's effect subscribes - a
 * notification tap that cold-opens Pick Up Your Cross would otherwise be lost.
 */
export function signalNotificationPermissionMoment(trigger: PermissionTrigger): void {
	if (listener) {
		listener(trigger);
		return;
	}
	// An explicit Settings request outranks a passive moment while queued.
	if (pending !== "settings-enabled") pending = trigger;
}

export function subscribePermissionTriggers(next: TriggerListener): () => void {
	listener = next;
	const queued = pending;
	pending = null;
	if (queued) next(queued);
	return () => {
		if (listener === next) listener = null;
	};
}
